/* eslint-disable */

// Covers the program SAVE path through the real editor, which nothing tested
// before: the earlier suite only built program arrays by hand and read them
// back. This renders the actual editor with makeProgram21, fills the real
// fields, and drives submitProgram21 -- the exact code the Save button runs --
// asserting the fertigation percentage lands as seconds in the pf parameter
// and the name is sent as the name param. A regression here is what
// makes a saved program come back with the wrong name.

describe("Fertigation Program Save Checks", function () {
	var controller;
	var fixture;
	var sandbox;

	function makeController() {
		return {
			options: { fwv: 221, fwm: 5, mas: 0, mas2: 0, mas3: 0, mas4: 0, sdt: 0, wl: 100 },
			settings: { ps: [ [ 0, 0, 0 ] ], wto: {} },
			stations: {
				snames: [ "Zone A", "Zone B", "Fert Valve" ],
				stn_dis: [ 0, 0, 0 ]
			},
			// name at 5, date range at 6, sensor adjustment at 7, fertigation at 8
			programs: {
				pnsize: 32,
				pd: [ [ 65, 127, 0, [ 360, -1, -1, -1 ], [ 600, 0, 0 ], "Original", [ 0, 33, 415 ], {}, [ 0, 0, 0 ] ] ]
			},
			fertigation: { fert_station: 2 },
			sensors: { sn: [] },
			sensor_desc: {}
		};
	}

	beforeEach(function () {
		controller = OSApp.currentSession.controller;
		OSApp.currentSession.controller = makeController();
		fixture = $("<div class='fert-save-fixture'></div>").appendTo("body");

		sandbox = sinon.createSandbox();
		sandbox.stub(OSApp.Firmware, "checkOSVersion").returns(true);
		sandbox.stub(OSApp.Supported, "dateRange").returns(false);
		sandbox.stub(OSApp.Supported, "groups").returns(false);
		sandbox.stub(OSApp.Groups, "calculateTotalRunningTime").returns(600);
		sandbox.stub(OSApp.UIDom, "fixInputClick");
		// station 2 is the fertigation valve; none are master here
		sandbox.stub(OSApp.Stations, "isMaster").returns(false);
		sandbox.stub(OSApp.Stations, "isDisabled").returns(false);
		sandbox.stub(OSApp.Stations, "getName").callsFake(function (i) {
			return OSApp.currentSession.controller.stations.snames[ i ];
		});
	});

	afterEach(function () {
		fixture.remove();
		$("#programs, #run-program-dialog, #runonce, #preview").remove();
		sandbox.restore();
		OSApp.currentSession.controller = controller;
	});

	it("renders per-zone fertigation controls and marks the fertigation valve", function () {
		var page = OSApp.Programs.makeProgram21( 0, false );
		fixture.append( page );

		// zones get a fertigation percentage button; the fertigation valve does not
		assert.isTrue( fixture.find( "#fert-0-0" ).length === 1, "zone 0 has a fertigation control" );
		assert.isTrue( fixture.find( "#fert-1-0" ).length === 1, "zone 1 has a fertigation control" );
		assert.isTrue( fixture.find( "#fert-2-0" ).length === 0, "the fertigation valve has no percentage control" );
		assert.match( fixture.find( "#station_2-0" ).text(), /Fertigation/i,
			"the fertigation valve is labelled, not waterable" );
	});

	it("reads back the existing name from index 5", function () {
		var page = OSApp.Programs.makeProgram21( 0, false );
		fixture.append( page );
		assert.equal( fixture.find( "#name-0" ).val(), "Original",
			"the name field shows the stored name" );
	});

	it("saves the name in name= and the fertigation as seconds in the pf parameter", function () {
		var sent = [];
		sandbox.stub( OSApp.Firmware, "sendToOS" ).callsFake( function ( dest ) {
			if ( String( dest ).indexOf( "/cp" ) === 0 ) { sent.push( decodeURIComponent( dest ) ); }
			return $.Deferred().resolve( { result: 1 } ).promise();
		} );

		var page = OSApp.Programs.makeProgram21( 0, false );
		fixture.append( page );

		// operator edits: rename, keep zone 0 at 600s, set 20% fertigation on it
		fixture.find( "#name-0" ).val( "Renamed" );
		fixture.find( "#station_0-0" ).val( 600 );
		fixture.find( "#fert-0-0" ).val( 20 );

		OSApp.Programs.submitProgram21( "0" );

		assert.isTrue( sent.length > 0, "a /cp save was issued" );
		var req = sent[ sent.length - 1 ];

		assert.include( req, "name=Renamed", "the name is sent as the name param" );

		var v = ( req.match( /[?&]v=([^&]*)/ ) || [ , "" ] )[ 1 ];
		var parsed = JSON.parse( v );
		// v = [flag, days0, days1, [starttimes], [durations]] -- stock-compatible,
		// with no fertigation inside it
		assert.equal( parsed.length, 5, "v carries no fertigation (stock-compatible)" );
		assert.deepEqual( parsed[ 4 ], [ 600, 0, 0 ], "durations preserved at index 4" );

		// fertigation travels in the pf parameter; 20% of 600s = 120s
		var pf = decodeURIComponent( ( req.match( /[?&]pf=([^&]*)/ ) || [ , "" ] )[ 1 ] );
		assert.deepEqual( JSON.parse( pf ), [ 120, 0, 0 ], "fertigation seconds sent in pf" );
	} );

	it("omits the fertigation array entirely when the controller does not support it", function () {
		// A stock/unsupported controller must not receive an empty [] the parser
		// would walk off the end of.
		delete OSApp.currentSession.controller.fertigation;

		var sent = [];
		sandbox.stub( OSApp.Firmware, "sendToOS" ).callsFake( function ( dest ) {
			if ( String( dest ).indexOf( "/cp" ) === 0 ) { sent.push( decodeURIComponent( dest ) ); }
			return $.Deferred().resolve( { result: 1 } ).promise();
		} );

		var page = OSApp.Programs.makeProgram21( 0, false );
		fixture.append( page );
		fixture.find( "#name-0" ).val( "NoFert" );
		fixture.find( "#station_0-0" ).val( 300 );

		OSApp.Programs.submitProgram21( "0" );

		var req = sent[ sent.length - 1 ];
		var parsed = JSON.parse( ( req.match( /[?&]v=([^&]*)/ ) || [ , "" ] )[ 1 ] );
		assert.equal( parsed.length, 5, "v has no fertigation array" );
		assert.isNull( req.match( /[?&]pf=/ ), "no pf parameter is sent when unsupported" );
	} );
} );
