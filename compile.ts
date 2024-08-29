import { walk } from "https://deno.land/std/fs/mod.ts";
import { resolve } from "https://deno.land/std/path/mod.ts";

async function compileProject() {
    const actorsDir = "./actors";
    const includes = [];

    for await (const entry of walk(actorsDir, { exts: [".ts"] })) {
        if (entry.isFile) {
            // Use resolve to normalize the path and convert backslashes to forward slashes
            const normalizedPath = resolve(entry.path).replace(/\\/g, '/');
            includes.push(`--include=${normalizedPath}`);
        }
    }

    const compileCommand = [
        "deno",
        "compile",
        "-A",
        "--no-check",
        "-o",
        "PetPlay.exe",
        ...includes,
        "init.ts"
    ];

    console.log("Executing compile command:", compileCommand.join(" "));

    const process = Deno.run({
        cmd: compileCommand,
    });

    const status = await process.status();

    if (!status.success) {
        console.error("Deno compilation failed");
        Deno.exit(status.code);
    }

    console.log("Deno compilation successful");

    // Now run the additional compile command in the ./Hyperswarm directory using Deno.Command with Node.js
    const hyperswarmDir = "./Hyperswarm";
    const pkgCommand = "pkg -t node20-win-x64 main.js";

    console.log(`Changing directory to ${hyperswarmDir} and executing pkg command via Node.js`);

    try {
        const command = new Deno.Command("node", {
            args: [
                "-e",
                `require('child_process').execSync('${pkgCommand}', { stdio: 'inherit', cwd: '${hyperswarmDir}' });`
            ],
            stdout: "piped",
            stderr: "piped"
        });

        const { success, code, stdout, stderr } = await command.output();

        if (!success) {
            console.error("Pkg compilation failed with exit code", code);
            console.error(new TextDecoder().decode(stderr));
            Deno.exit(code);
        }

        console.log(new TextDecoder().decode(stdout));
        console.log("Pkg compilation successful");
    } catch (error) {
        console.error("Error running pkg command:", error);
        Deno.exit(1);
    }
}

await compileProject();
