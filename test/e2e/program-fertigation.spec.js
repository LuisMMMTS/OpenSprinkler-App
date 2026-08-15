/* eslint-disable */

// End-to-end: a real browser, the real app bundle, and a real controller.
//
// The karma suite tests module logic in isolation and the firmware suite tests
// the API. Neither can catch an integration failure, and there was one: when
// the app is served from its own host rather than by the controller, it loads
// through the per-endpoint path (/jp /jn /jo /js /jc ...) and never calls /ja.
// The fertigation station is only in /ja, so the entire fertigation UI silently
// vanished in exactly the deployment shape this project uses. The first test
// below pins that.
//
// Environment:
//   OS_APP_URL   where the app bundle is served     (default: the hub)
//   OS_API_URL   the controller, for direct API assertions
//   OS_SITE_IP   what to store as the site address; set to "<hub>/site1" to
//                drive traffic through the reverse proxy instead of direct
//   OS_PASSWORD  md5 of the device password
//
// Note on navigation: the app routes on hashchange, so a hash in the initial
// URL is ignored. Every test loads the root, waits for the controller data,
// and only then navigates.

const { test, expect, request } = require("@playwright/test");

const APP = process.env.OS_APP_URL || "http://192.168.1.180:8080";
const API = process.env.OS_API_URL || "http://192.168.1.81:8080";
const PW = process.env.OS_PASSWORD || "a6d82bced638de3def1e9bbb4983225c";
const SITE_IP = process.env.OS_SITE_IP || API.replace(/^https?:\/\//, "");

const ZONE = 0;
const FERT_STATION = 7;
const PROGRAM_NAME = "E2E Fertigation";

async function api(ctx, path, params = {}) {
	const q = new URLSearchParams({ pw: PW, ...params }).toString();
	const res = await ctx.get(`${API}/${path}?${q}`);
	expect(res.ok(), `${path} responded ${res.status()}`).toBeTruthy();
	return res.json();
}

async function openApp(page) {
	await page.addInitScript(
		([ip, pw]) => {
			localStorage.setItem("sites", JSON.stringify({ E2E: { os_ip: ip, os_pw: pw } }));
			localStorage.setItem("current_site", "E2E");
		},
		[SITE_IP, PW]
	);
	await page.goto(APP);
	await page.waitForFunction(
		() => window.OSApp && OSApp.currentSession && OSApp.currentSession.controller &&
			Array.isArray(OSApp.currentSession.controller.status),
		null,
		{ timeout: 60000 }
	);
}

/** Drive the app's number popup: click the control, type, submit. */
async function setViaPopup(page, selector, value) {
	await page.click(selector);
	const input = page.locator("#singleDuration input[type='number']");
	await input.waitFor({ state: "visible" });
	await input.fill(String(value));
	const submit = page.locator("#singleDuration input[type='submit']");
	if (await submit.count()) await submit.click();
	else await input.press("Enter");
	await page.waitForTimeout(600);
}

test.describe("Fertigation, end to end", () => {
	let ctx;

	test.beforeAll(async () => {
		ctx = await request.newContext();
		expect((await api(ctx, "cf", { fs: FERT_STATION })).result).toBe(1);
		await api(ctx, "dp", { pid: -1 });
	});

	test.afterAll(async () => {
		await api(ctx, "cv", { rsn: 1 });
		await ctx.dispose();
	});

	test("the app sees fertigation support when served from its own host", async ({ page }) => {
		const endpoints = [];
		page.on("request", (r) => {
			const m = r.url().match(/\/(j[a-z]+)\?pw=/);
			if (m) endpoints.push(m[1]);
		});

		await openApp(page);
		await page.waitForTimeout(3000);

		// The regression: this load path must fetch the fertigation station.
		expect(endpoints, "the load path queries /jf").toContain("jf");

		const state = await page.evaluate(() => ({
			supported: OSApp.Supported.fertigation(),
			station: OSApp.currentSession.controller.fertigation &&
				OSApp.currentSession.controller.fertigation.fert_station,
			isFert: OSApp.Stations.isFertigation(7),
			isNotFert: OSApp.Stations.isFertigation(0),
		}));

		expect(state.supported, "fertigation reported as supported").toBe(true);
		expect(state.station).toBe(FERT_STATION);
		expect(state.isFert, "station 7 identified as the fertigation valve").toBe(true);
		expect(state.isNotFert, "station 0 is an ordinary zone").toBe(false);
	});

	// SKIPPED, deliberately. jQuery Mobile builds the run-once page from a
	// pageshow handler that does not fire reliably under automation, so this
	// spends its time fighting the framework rather than testing the feature.
	// The behaviour it would cover -- percentage converted to seconds and sent
	// as fd<n> -- is asserted in test/tests/fertigation_checks.js against the
	// real submitRunonce(). Re-enable if a stable way to drive that page turns up.
	test.skip("run-once converts the entered percentage into seconds on the wire", async ({ page }) => {
		await openApp(page);

		// Navigating to a hash reloads the document here, so wait for the app to
		// reconnect before expecting the page to have been built.
		await page.goto(`${APP}/#runonce`);
		await page.waitForFunction(
			() => window.OSApp && OSApp.currentSession && OSApp.currentSession.controller &&
				Array.isArray(OSApp.currentSession.controller.status),
			null,
			{ timeout: 60000 }
		);
		await page.waitForSelector(`#zone-${ZONE}`, { timeout: 45000 });

		await expect(page.locator(`#zone-${ZONE}`), "zone control rendered").toBeVisible();
		await expect(page.locator(`#fert-${ZONE}`),
			"fertigation control rendered next to the zone").toBeVisible();

		// The fertigation valve itself must not be waterable
		await expect(page.locator(`#zone-${FERT_STATION}`)).toBeDisabled();

		await setViaPopup(page, `#zone-${ZONE}`, 100);
		await setViaPopup(page, `#fert-${ZONE}`, 50);

		const sent = [];
		page.on("request", (r) => { if (r.url().includes("/cr?")) sent.push(r.url()); });

		await page.click("a:has-text('Submit'), button:has-text('Submit'), input[type='submit'][value*='Submit']");
		await page.waitForTimeout(4000);

		expect(sent.length, "a run-once was submitted").toBeGreaterThan(0);
		// 50% of 100s, expressed in seconds because that is what the firmware parses
		expect(sent[sent.length - 1]).toContain(`fd${ZONE}=50`);

		await api(ctx, "cv", { rsn: 1 });
	});

	test("a stored program is read back with its fertigation intact after a reload", async ({ page }) => {
		// Create through the API, then prove the app parses it correctly after a
		// genuine page load. 65 = enabled + fixed start times.
		await api(ctx, "dp", { pid: -1 });
		const v = `[65,127,0,[360,-1,-1,-1],[600,300,0,0,0,0,0,0],[120,60,0,0,0,0,0,0]]`;
		expect((await api(ctx, "cp", { pid: -1, v, name: PROGRAM_NAME })).result).toBe(1);

		await openApp(page);
		await page.waitForTimeout(3000);

		const parsed = await page.evaluate(() => {
			const pd = OSApp.currentSession.controller.programs.pd;
			const prog = pd[0];
			const data = OSApp.Programs.readProgram21(prog);
			return {
				count: pd.length,
				name: data.name,
				stations: data.stations.slice(0, 3),
				fertigation: data.fertigation.slice(0, 3),
				hasFertArray: OSApp.Programs.hasFertigationArray(prog),
				pidName: OSApp.Programs.pidToName(1),
				// the percentage the editor would render for this zone
				renderedPercent: Math.round((data.fertigation[0] * 100) / data.stations[0]),
			};
		});

		expect(parsed.count).toBe(1);
		expect(parsed.hasFertArray, "index 5 recognised as the fertigation array").toBe(true);
		expect(parsed.name, "name survived the reload").toBe(PROGRAM_NAME);
		expect(parsed.pidName, "program name resolves from the shifted index").toBe(PROGRAM_NAME);
		expect(parsed.stations[0], "zone duration in seconds").toBe(600);
		expect(parsed.fertigation[0], "fertigation stored in seconds").toBe(120);
		expect(parsed.renderedPercent, "renders back as the 20% that produced it").toBe(20);

		await api(ctx, "dp", { pid: -1 });
	});
});
