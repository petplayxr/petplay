// Decompile functions at the image-base-relative offsets given in env DECOMP_ADDRS (comma separated hex).
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import java.io.*;

public class Decomp extends GhidraScript {
  @Override
  public void run() throws Exception {
    String addrs = System.getenv("DECOMP_ADDRS");
    String outDir = System.getenv("DECOMP_OUT");
    DecompInterface di = new DecompInterface();
    di.openProgram(currentProgram);
    Address base = currentProgram.getImageBase();
    for (String a : addrs.split(",")) {
      Address addr = base.add(Long.parseLong(a.trim(), 16));
      Function f = getFunctionContaining(addr);
      if (f == null) { createFunction(addr, null); f = getFunctionAt(addr); }
      PrintWriter w = new PrintWriter(new FileWriter(outDir + "/" + currentProgram.getName() + "_" + a.trim() + ".c"));
      if (f == null) { w.println("// no function at " + addr); w.close(); continue; }
      DecompileResults r = di.decompileFunction(f, 120, monitor);
      w.println("// " + f.getName() + " @ " + f.getEntryPoint() + " (requested " + addr + ")");
      w.println(r.decompileCompleted() ? r.getDecompiledFunction().getC() : "// failed: " + r.getErrorMessage());
      w.close();
    }
  }
}
