//this will be used to manage the OVRINTERFACE at runtime

class ExecRunner {
    constructor(private executablePath: string) {}


    run(args: string[]) {
        const command = new Deno.Command(this.executablePath, {
          args: args,
          stdout: "piped",
          stderr: "piped",
        });
      
        const { code, stdout, stderr } = command.outputSync();
        // Log stdout and stderr separately
        console.log("Standard Output:");
        console.log(new TextDecoder().decode(stdout));
        console.log("Standard Error:");
        console.log(new TextDecoder().decode(stderr));
        if (code!== 0) {
          throw new Error(`Command failed with exit code ${code}: ${new TextDecoder().decode(stderr)}`);
        }
      
        
    }
}

const execRunner = new ExecRunner("c:/GIT/petplay/OVRINTERFACE/out/build/default/Debug/petplay.exe");
execRunner.run(["true","27015"]);