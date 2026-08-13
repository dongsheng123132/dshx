#!/usr/bin/env node

const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("0.1.0-test\n");
  process.exit(0);
}

const task = args.at(-1) ?? "";
if (task === "fail") {
  process.stderr.write("fixture failure\n");
  process.exit(7);
}
if (task === "hang") {
  setInterval(() => {}, 1000);
} else if (task === "ansi") {
  process.stdout.write("\u001b[31mclean answer\u001b[0m\n");
} else {
  process.stdout.write(`answer:${task}\n`);
}
