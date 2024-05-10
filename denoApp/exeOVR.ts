

// Adjusting permissions to ensure the file is executable (important on Unix-like systems)
/* await Deno.chmod(execPath, 0o755); */

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
        if (code !== 0) {
          throw new Error(`Command failed with exit code ${code}: ${new TextDecoder().decode(stderr)}`);
        }
    }
}

// Instantiate the runner with the path to the executable
const execRunner = new ExecRunner("./dependencies/petplay.exe");
execRunner.run(["true", "27015"]);
