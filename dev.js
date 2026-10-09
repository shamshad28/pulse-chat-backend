require("dotenv").config({ path: __dirname + "/.env" });

const { spawn, execSync } = require("child_process");
const http = require("http");

const port = Number(process.env.PORT) || 5000;

const freePortIfOccupied = () => {
  try {
    if (process.platform === "win32") {
      const output = execSync(
        `powershell -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`
      )
        .toString()
        .trim();

      const pids = output.split(/\s+/).filter(Boolean);
      let killed = false;
      for (const pid of pids) {
        if (Number(pid) && Number(pid) !== process.pid) {
          console.log(`Freeing port ${port} by terminating PID ${pid}...`);
          try {
            execSync(`taskkill /PID ${pid} /F`);
            killed = true;
          } catch {}
        }
      }
      if (killed) {
        // Allow Windows 500ms to release the socket
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
      }
    }
  } catch (err) {
    // Port may not be in use, ignore
  }
};

const startDevServer = () => {
  freePortIfOccupied();

  let runner = process.execPath;
  let runnerArgs = ["index.js"];

  try {
    const nodemonPath = require.resolve("nodemon/bin/nodemon.js");
    runner = process.execPath;
    runnerArgs = [nodemonPath, "--ignore", "uploads/*", "--ignore", "node_modules/*", "index.js"];
  } catch {
    runner = process.execPath;
    runnerArgs = ["index.js"];
  }

  console.log(`Starting backend server on port ${port}...`);

  const serverProc = spawn(runner, runnerArgs, {
    cwd: __dirname,
    stdio: "inherit",
    shell: false,
  });

  serverProc.on("error", (error) => {
    console.error("Failed to start server process:", error.message);
    process.exit(1);
  });

  serverProc.on("exit", (code) => {
    process.exit(code || 0);
  });

  process.on("SIGINT", () => {
    serverProc.kill("SIGINT");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    serverProc.kill("SIGTERM");
    process.exit(0);
  });
};

startDevServer();

