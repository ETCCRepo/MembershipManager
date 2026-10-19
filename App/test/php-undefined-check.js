// Static check for a bug class that neither Node tests nor PHP syntax checking can see (PHP is not installed on the
// dev machine): a membership_* function or MEMBERSHIP_* constant that is USED but not DEFINED in any deploy/*.php file
// is a fatal "undefined function" at run time, and only on the request paths that reach it. (A marker-based edit of
// lib.php once deleted 12 functions this way: the login page still worked, every logged-in page returned HTTP 500.)
// Used by test/run-tests.js; also runnable: node test/php-undefined-check.js [deploy-dir]
const fs = require("fs");
const path = require("path");

// Session keys and the like that look like callback names but are plain strings.
const NOT_FUNCTIONS = /^membership_(authenticated|csrf|auth_version|last_seen|dev_until)$/;

function check(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".php") && f !== "secrets.php");
  const src = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")]));
  const all = Object.values(src).join("\n");
  const defFns = new Set([...all.matchAll(/function\s+(membership_\w+)\s*\(/g)].map((m) => m[1]));
  const defConsts = new Set(
    [...all.matchAll(/\bconst\s+(MEMBERSHIP_\w+)\s*=/g)].map((m) => m[1]).concat([...all.matchAll(/define\(\s*['"](MEMBERSHIP_\w+)['"]/g)].map((m) => m[1]))
  );
  const strip = (t) => t
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const problems = [];
  for (const [f, t] of Object.entries(src)) {
    const code = strip(t);
    for (const m of code.matchAll(/\b(membership_\w+)\s*\(/g)) if (!defFns.has(m[1])) problems.push("undefined function " + m[1] + " called in " + f);
    for (const m of code.matchAll(/\b(MEMBERSHIP_[A-Z_]+)\b/g)) if (!defConsts.has(m[1])) problems.push("undefined constant " + m[1] + " used in " + f);
  }
  // functions passed by name as callbacks, e.g. array_map('membership_clean_str', ...)
  for (const m of all.matchAll(/['"](membership_\w+)['"]/g)) {
    if (!defFns.has(m[1]) && !NOT_FUNCTIONS.test(m[1])) problems.push("undefined callback name " + m[1]);
  }
  return { problems: [...new Set(problems)], functions: defFns.size, constants: defConsts.size, files: files.length };
}

module.exports = { check };

if (require.main === module) {
  const r = check(process.argv[2] || path.join(__dirname, "..", "deploy"));
  if (r.problems.length) { r.problems.forEach((p) => console.log("PROBLEM:", p)); process.exit(1); }
  console.log("ok: every membership_* function and MEMBERSHIP_* constant in use is defined (" + r.functions + " functions, " + r.constants + " constants, " + r.files + " files)");
}
