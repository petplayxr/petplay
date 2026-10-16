import { childProcessArgs } from "./childModule.ts";

Deno.test({
  name:
    "source child restores inherited idle scheduling or reports denial and keeps child arguments",
  ignore: Deno.build.os !== "linux",
  async fn() {
    const dir = await Deno.makeTempDir({ prefix: "petplay-scheduling-" });
    try {
      const fixture = `${dir}/child.ts`;
      await Deno.writeTextFile(
        fixture,
        `const libc = Deno.dlopen("libc.so.6", {
          sched_getscheduler: { parameters: ["i32"], result: "i32" },
          sched_setscheduler: { parameters: ["i32", "i32", "buffer"], result: "i32" },
          getpriority: { parameters: ["i32", "u32"], result: "i32" },
        });
        const policies = [...Deno.readDirSync("/proc/self/task")]
          .map(t => libc.symbols.sched_getscheduler(Number(t.name)));
        console.log(JSON.stringify({
          name: Deno.readTextFileSync("/proc/self/comm").trim(),
          argv0: new TextDecoder().decode(Deno.readFileSync("/proc/self/cmdline")).split("\\0")[0],
          policies, args: Deno.args, nice: libc.symbols.getpriority(0, 0),
          canLeaveIdle: libc.symbols.sched_setscheduler(0, 0, new Int32Array([0])) === 0,
        }));
        libc.close();`,
      );
      const result = await new Deno.Command("chrt", {
        args: [
          "--idle",
          "0",
          "nice",
          "-n",
          "16",
          Deno.execPath(),
          ...childProcessArgs(new URL(`file://${fixture}`), ["--fixture-arg"], false),
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
      const report = JSON.parse(new TextDecoder().decode(result.stdout).trim());
      if (
        report.name !== "petplay" || report.argv0 !== "ppvr"
      ) {
        throw new Error(`identity/idle recovery failed: ${JSON.stringify(report)}`);
      }
      const idleRemains = report.policies.some((p: number) => p === 5);
      if (idleRemains && report.canLeaveIdle) {
        throw new Error(`idle scheduling was recoverable: ${JSON.stringify(report)}`);
      }
      // RLIMIT_NICE/CAP_SYS_NICE can prevent leaving SCHED_IDLE at nice 16.
      // The same direct syscall checks the host policy without skipping recovery assertions.
      if (idleRemains && !/"deniedThreads":[1-9]/.test(new TextDecoder().decode(result.stderr))) {
        throw new Error("scheduler denial was not reported");
      }
      if (JSON.stringify(report.args) !== JSON.stringify(["--fixture-arg"])) {
        throw new Error(`child arguments changed: ${JSON.stringify(report.args)}`);
      }
      // Without privilege, positive niceness may remain; that must not stop the app.
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "startup preserves intentionally batch-scheduled threads",
  ignore: Deno.build.os !== "linux",
  async fn() {
    const helper = new URL("./linuxScheduling.ts", import.meta.url).href;
    const result = await new Deno.Command(Deno.execPath(), {
      args: [
        "eval",
        "--no-check",
        `const { initializeLinuxScheduling } = await import(${JSON.stringify(helper)});
        const l = Deno.dlopen("libc.so.6", {
          sched_setscheduler: { parameters: ["i32", "i32", "buffer"], result: "i32" },
          sched_getscheduler: { parameters: ["i32"], result: "i32" },
          setpriority: { parameters: ["i32", "u32", "i32"], result: "i32" },
          getpriority: { parameters: ["i32", "u32"], result: "i32" },
        });
        if (l.symbols.sched_setscheduler(0, 3, new Int32Array([0])) !== 0) throw Error("batch setup");
        l.symbols.setpriority(0, 0, 19);
        initializeLinuxScheduling();
        if (l.symbols.sched_getscheduler(0) !== 3 || l.symbols.getpriority(0, 0) !== 19) {
          throw Error("intentional batch scheduling was changed");
        }
        l.close();`,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
  },
});

Deno.test({
  name: "recreated WebXR-style workers preserve scheduler identity and process discovery",
  ignore: Deno.build.os !== "linux",
  async fn() {
    const dir = await Deno.makeTempDir({ prefix: "petplay-reload-scheduling-" });
    try {
      const helper = new URL("./linuxScheduling.ts", import.meta.url).href;
      const worker = `${dir}/worker.ts`;
      const driver = `${dir}/driver.ts`;
      await Deno.writeTextFile(
        worker,
        `
        import { initializeLinuxScheduling } from ${JSON.stringify(helper)};
        const status = initializeLinuxScheduling();
        postMessage(status);
        onmessage = () => {};
      `,
      );
      await Deno.writeTextFile(
        driver,
        `
        import { initializeLinuxScheduling } from ${JSON.stringify(helper)};
        const command = () => new TextDecoder().decode(Deno.readFileSync("/proc/self/cmdline"))
          .split("\\0").filter(Boolean);
        const before = command().slice(1);
        const executable = Deno.execPath();
        initializeLinuxScheduling();
        const l = Deno.dlopen("libc.so.6", {
          sched_getscheduler: { parameters: ["i32"], result: "i32" },
          getpriority: { parameters: ["i32", "u32"], result: "i32" },
        });
        try {
          for (let reload = 0; reload < 3; reload++) {
            const w = new Worker(${
          JSON.stringify(new URL(`file://${worker}`).href)
        }, { type: "module" });
            try {
              await new Promise((resolve, reject) => {
                w.onmessage = e => e.data.error ? reject(Error(e.data.error)) : resolve(e.data);
                w.onerror = e => reject(Error(e.message));
              });
              await new Promise(r => setTimeout(r, 3_500));
              if (command()[0] !== "ppvr" || JSON.stringify(before) !== JSON.stringify(command().slice(1)) ||
                  Deno.execPath() !== executable) throw Error("argv/executable identity changed incorrectly");
              for (const task of Deno.readDirSync("/proc/self/task")) {
                const tid = Number(task.name);
                if (l.symbols.sched_getscheduler(tid) === 5) throw Error("reload " + reload + " left idle " + tid + " " + Deno.readTextFileSync("/proc/self/task/"+tid+"/comm").trim() + " nice="+l.symbols.getpriority(0,tid) + " argv0="+new TextDecoder().decode(Deno.readFileSync("/proc/"+tid+"/cmdline")).split("\\0")[0]);
              }
            } finally { w.terminate(); }
          }
        } finally { l.close(); }
      `,
      );
      const result = await new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", "--no-check", driver, "--discovery-marker"],
        stdout: "piped",
        stderr: "piped",
      }).output();
      if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
