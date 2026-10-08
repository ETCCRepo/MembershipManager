/* build.js — inline src + assets into a single self-contained ETCCMembership.html,
 * the same way the CarShow app's build.js produces ETCCCarShow.html.
 * Usage: node build.js [outputPath]
 *
 * The output carries NO member data: deploy/index.php injects the current
 * members-data.json into it on every request (see deploy/README.md).
 */
var fs = require("fs");
var path = require("path");

var HERE = __dirname;
function read(p) { return fs.readFileSync(path.join(HERE, p), "utf8"); }
// Prevent a stray "</script>" in source text from closing our script tag.
function safeJs(s) { return s.replace(/<\/script>/gi, "<\\/script>"); }

var logoDataUri = "data:image/png;base64," + fs.readFileSync(path.join(HERE, "assets/ETCClogoWhiteBackground.png")).toString("base64");
var reportsBannerDataUri = "data:image/jpeg;base64," + fs.readFileSync(path.join(HERE, "assets/reports-banner.jpg")).toString("base64");
var reportsBannerScript = "window.__membershipReportsBanner = " + JSON.stringify(reportsBannerDataUri) + ";";

var css = read("src/styles.css");
var scripts = [
  read("src/logic.js"),
  reportsBannerScript,
  read("src/app.js")
].map(safeJs);

// Version: starts at 1.0 and bumps the minor number on every build, stamped
// into the footer at build time (same scheme as CarShow's build.js).
// MEMBERSHIP_VERSION=1.7 overrides it for one build.
var VERSION_PATH = path.join(HERE, "version.json");
var version = { major: 1, minor: 0 };
if (fs.existsSync(VERSION_PATH)) {
  try { version = JSON.parse(fs.readFileSync(VERSION_PATH, "utf8")); } catch (e) { /* fall back to 1.0 */ }
}
var override = (process.env.MEMBERSHIP_VERSION || "").trim();
var overrideMatch = override.match(/^(\d+)\.(\d+)$/);
if (overrideMatch) version = { major: Number(overrideMatch[1]), minor: Number(overrideMatch[2]) };
else if (override) throw new Error('MEMBERSHIP_VERSION must look like "1.7" (got "' + override + '").');
var versionString = version.major + "." + version.minor;
var builtAt = new Date();
if (!process.env.MEMBERSHIP_NO_BUMP) {
  fs.writeFileSync(VERSION_PATH, JSON.stringify({ major: version.major, minor: version.minor + 1, lastBuilt: builtAt.toISOString() }, null, 2) + "\n");
}

function fmtDateTime(d) {
  function p(n) { return (n < 10 ? "0" : "") + n; }
  var h = d.getHours(), ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
  return p(d.getMonth() + 1) + "/" + p(d.getDate()) + "/" + d.getFullYear() + " " + p(h) + ":" + p(d.getMinutes()) + " " + ap;
}

var html =
'<!DOCTYPE html>\n' +
'<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
'<title>ETCC Membership</title>\n' +
'<link rel="icon" type="image/png" href="ETCClogoWhiteBackground.png">\n' +
'<link rel="apple-touch-icon" href="ETCClogoWhiteBackground.png">\n' +
'<style>\n' + css + '\n</style>\n</head>\n<body>\n' +
'<header class="app">\n' +
'  <div class="hdr-left"><img src="' + logoDataUri + '" alt="ETCC Logo" class="hdr-logo"></div>\n' +
'  <div class="hdr-center"><h1>Membership Manager</h1></div>\n' +
'  <div class="hdr-right"></div>\n' +
'</header>\n' +
'<div class="wrap">\n' +
'  <div id="app"></div>\n' +
'</div>\n' +
'<div id="detailHost"></div>\n' +
'<div id="reportHost"></div>\n' +
'<footer class="app-footer">\n' +
'  <div class="footer-credit">v' + versionString + ' &middot; Built ' + fmtDateTime(builtAt) +
' &middot; Website by <a href="https://businesswebexpress.com" target="_blank" rel="noopener">Business Web Express</a>' +
' &middot; &copy; 2026 East Tennessee Corvette Club &middot; Knoxville, TN &middot; <a href="mailto:etccwebsite.webmanager@gmail.com">etccwebsite.webmanager@gmail.com</a></div>\n' +
'</footer>\n' +
scripts.map(function (s) { return '<script>\n' + s + '\n</script>'; }).join("\n") +
'\n</body>\n</html>\n';

var out = process.argv[2] || path.join(HERE, "ETCCMembership.html");
fs.writeFileSync(out, html);
console.log("Wrote " + out + " (" + Math.round(Buffer.byteLength(html) / 1024) + " KB)");
