/* eslint-disable */

// End-to-end tests: a real browser driving the real app against a real
// controller. The karma suite covers module logic in isolation; this covers
// the thing that suite cannot, which is whether a program created through the
// UI survives a save, a reload, and a render, and lands in the firmware with
// the values the operator actually typed.
//
// Both endpoints are supplied by the environment so this can run against a
// DEMO build on a workstation or a real controller on the bench:
//
//   OS_APP_URL   where the app bundle is served   (default: the hub)
//   OS_API_URL   the controller, as the browser reaches it
//   OS_SITE_IP   what to store as the site address; defaults to OS_API_URL
//                minus the scheme. Set this to "<hub>/site1" to exercise the
//                reverse proxy rather than talking to the controller directly.
//   OS_PASSWORD  md5 of the device password (default: md5("opendoor"))
//
// Uses the locally installed Chrome rather than downloading a browser.

const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
	testDir: ".",
	testMatch: /.*\.spec\.js/,
	// The app polls the controller and jQuery Mobile animates page transitions,
	// so these are deliberately patient rather than fast.
	timeout: 120000,
	expect: { timeout: 20000 },
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: [["list"]],
	use: {
		baseURL: process.env.OS_APP_URL || "http://192.168.1.180:8080",
		channel: "chrome",
		headless: true,
		viewport: { width: 1280, height: 900 },
		actionTimeout: 20000,
		trace: "retain-on-failure",
	},
});
