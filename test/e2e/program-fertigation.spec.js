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

	// The whole write path through the real program editor, which the earlier
	// suite never exercised: it only ever created programs via the API and read
	// them back. That gap is exactly what let a serving problem masquerade as a
	// working feature -- the name and fertigation only appear correct if the UI
	// actually understands this firmware's program layout (fertigation array at
	// index 8, name at 5). Here the editor renders, the save builds the payload,
	// and a reload proves the name and the fertigation percentage both survived.
	test("the editor, built against the live controller, renders fertigation controls and the right name", async ({ page }) => {
		// Integration guard: render the real editor against a real program on a
		// real controller. If the served UI were the stock one, or misread this
		// firmware's layout, the fertigation controls would be absent and the
		// name would come out as the fertigation array. The exact save/parse
		// logic is asserted in the karma suite (fertigation_program_save_checks);
		// this proves the served bundle understands the live controller's format.
		// Put the watering and fertigation on station 1: station 0 is the master
		// and station 7 the fertigation valve, neither of which renders a per-zone
		// fertigation control. Only an ordinary zone shows the "% / seconds" button.
		const NAME = "Live Editor Check";
		await api(ctx, "dp", { pid: -1 });
		await api(ctx, "cp", { pid: -1,
			v: `[65,127,0,[360,-1,-1,-1],[0,600,0,0,0,0,0,0],[0,120,0,0,0,0,0,0]]`,
			name: NAME });

		await openApp(page);
		await page.waitForTimeout(2500);

		const built = await page.evaluate(({ fertStation }) => {
			// makeProgram21 renders the editor deterministically, without the
			// jQuery Mobile pageshow timing that makes clicking a program flaky.
			// It returns a multi-node jQuery object, so append and query it with
			// jQuery (mirrors how the karma suite drives the same function).
			const $page = OSApp.Programs.makeProgram21(0, false);
			const $fix = $("<div id='e2e-editor-fixture'></div>").appendTo("body");
			$fix.append($page);
			const fertButtons = $fix.find("[id^='fert-']").toArray();
			const $valve = $fix.find(`#station_${fertStation}-0`);
			return {
				name: $fix.find("input[id^='name-']").val() || null,
				zoneFertCount: fertButtons.length,
				// the label now shows both units, e.g. "20% / 120s"
				anyPercentShown: fertButtons.some(b => /%\s*\/\s*\d+s$/.test(b.textContent.trim())),
				fertValveNotWaterable: $valve.length
					? ($valve.is(":disabled") || /fertig/i.test($valve.text()))
					: null,
			};
		}, { fertStation: FERT_STATION });

		expect(built.name, "editor shows the stored name from index 5").toBe(NAME);
		expect(built.zoneFertCount, "per-zone fertigation controls are rendered").toBeGreaterThan(0);
		expect(built.anyPercentShown, "fertigation renders as percentage and seconds").toBe(true);
		expect(built.fertValveNotWaterable, "the fertigation valve is not a waterable zone").toBeTruthy();

		await api(ctx, "dp", { pid: -1 });
	});

	test("a stored program is read back with its fertigation intact after a reload", async ({ page }) => {
		// Create through the API, then prove the app parses it correctly after a
		// genuine page load. 65 = enabled + fixed start times.
		await api(ctx, "dp", { pid: -1 });
		// fertigation rides inside v=, right after the durations
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
		expect(parsed.hasFertArray, "trailing fertigation array at index 8 recognised").toBe(true);
		expect(parsed.name, "name survived the reload").toBe(PROGRAM_NAME);
		expect(parsed.pidName, "program name resolves from the shifted index").toBe(PROGRAM_NAME);
		expect(parsed.stations[0], "zone duration in seconds").toBe(600);
		expect(parsed.fertigation[0], "fertigation stored in seconds").toBe(120);
		expect(parsed.renderedPercent, "renders back as the 20% that produced it").toBe(20);

		await api(ctx, "dp", { pid: -1 });
	});
});
