/* eslint-disable */

describe( "Fertigation Checks", function() {
	var controller;
	var sandbox;

	// The program object is stock-compatible: name at 5, date range at 6, sensor
	// adjustment at 7 -- exactly where the stock UI reads them. This fork appends
	// the fertigation-seconds array as a trailing field at index 8, which the
	// stock UI ignores. A stock program has no such trailing field.
	function fertProgram( opts ) {
		opts = opts || {};
		return [
			opts.flag === undefined ? 65 : opts.flag,
			127, 0,
			[ 360, -1, -1, -1 ],
			opts.durations || [ 600, 300, 0 ],
			opts.name === undefined ? "Fert Program" : opts.name,
			opts.daterange || [ 1, 33, 415 ],
			{},                                    // sensor adjustment
			opts.fertigation || [ 120, 60, 0 ]     // trailing fertigation array
		];
	}

	function stockProgram( opts ) {
		opts = opts || {};
		return [
			opts.flag === undefined ? 65 : opts.flag,
			127, 0,
			[ 360, -1, -1, -1 ],
			opts.durations || [ 600, 300, 0 ],
			opts.name === undefined ? "Stock Program" : opts.name,
			opts.daterange || [ 1, 33, 415 ],
			{}                                     // no trailing fertigation field
		];
	}

	beforeEach( function() {
		controller = OSApp.currentSession.controller;
		OSApp.currentSession.controller = {
			options: { wl: 100 },
			settings: {},
			stations: { snames: [ "Zone One", "Zone Two", "Fert Valve" ] },
			programs: { pd: [] },
			fertigation: { fert_station: 2 }
		};
		sandbox = sinon.createSandbox();
	} );

	afterEach( function() {
		$( "#runonce" ).remove();
		sandbox.restore();
		OSApp.currentSession.controller = controller;
	} );

	// ---------------------------------------------------------- capability

	describe( "OSApp.Supported.fertigation", function() {
		it( "reports supported when the controller sends a fertigation object", function() {
			assert.isTrue( OSApp.Supported.fertigation() );
		} );

		it( "reports unsupported when the key is absent", function() {
			delete OSApp.currentSession.controller.fertigation;
			assert.isFalse( OSApp.Supported.fertigation() );
		} );

		it( "reports unsupported for null rather than treating it as an object", function() {
			OSApp.currentSession.controller.fertigation = null;
			assert.isFalse( OSApp.Supported.fertigation() );
		} );

		it( "does not throw when there is no controller at all", function() {
			OSApp.currentSession.controller = undefined;
			assert.isFalse( OSApp.Supported.fertigation() );
		} );
	} );

	// ------------------------------------------------------------ stations

	describe( "OSApp.Stations.isFertigation", function() {
		it( "identifies only the configured station", function() {
			assert.isFalse( OSApp.Stations.isFertigation( 0 ) );
			assert.isFalse( OSApp.Stations.isFertigation( 1 ) );
			assert.isTrue( OSApp.Stations.isFertigation( 2 ) );
		} );

		it( "identifies no station when 255 means unconfigured", function() {
			OSApp.currentSession.controller.fertigation.fert_station = 255;
			assert.isFalse( OSApp.Stations.isFertigation( 0 ) );
			assert.isFalse( OSApp.Stations.isFertigation( 255 ) );
		} );

		it( "identifies no station when the controller lacks support", function() {
			delete OSApp.currentSession.controller.fertigation;
			assert.isFalse( OSApp.Stations.isFertigation( 2 ) );
		} );
	} );

	describe( "OSApp.Stations.setFertilizerStations", function() {
		beforeEach( function() {
			sandbox.stub( OSApp.currentSession, "isControllerConnected" ).returns( true );
		} );

		it( "sends the station to /cf and caches the new value", function( done ) {
			sandbox.stub( OSApp.Firmware, "sendToOS" )
				.returns( $.Deferred().resolve( { result: 1 } ).promise() );

			OSApp.Stations.setFertilizerStations( 1, function( success ) {
				assert.isTrue( success );
				assert.isTrue( OSApp.Firmware.sendToOS.calledWith( "/cf?pw=&fs=1" ) );
				assert.equal( OSApp.currentSession.controller.fertigation.fert_station, 1 );
				done();
			} );
		} );

		it( "sends 255 to unconfigure", function( done ) {
			sandbox.stub( OSApp.Firmware, "sendToOS" )
				.returns( $.Deferred().resolve( { result: 1 } ).promise() );

			OSApp.Stations.setFertilizerStations( 255, function() {
				assert.isTrue( OSApp.Firmware.sendToOS.calledWith( "/cf?pw=&fs=255" ) );
				done();
			} );
		} );

		it( "reports failure and leaves the cache alone when the controller rejects", function( done ) {
			sandbox.stub( OSApp.Firmware, "sendToOS" )
				.returns( $.Deferred().resolve( { result: 17 } ).promise() );

			OSApp.Stations.setFertilizerStations( 40, function( success ) {
				assert.isFalse( success );
				assert.equal( OSApp.currentSession.controller.fertigation.fert_station, 2 );
				done();
			} );
		} );

		it( "reports failure when the request itself fails", function( done ) {
			sandbox.stub( OSApp.Firmware, "sendToOS" )
				.returns( $.Deferred().reject().promise() );

			OSApp.Stations.setFertilizerStations( 1, function( success ) {
				assert.isFalse( success );
				done();
			} );
		} );
	} );

	// ------------------------------------------------------- payload shape

	describe( "OSApp.Programs.hasFertigationArray", function() {
		it( "detects the trailing fertigation array at index 8", function() {
			assert.isTrue( OSApp.Programs.hasFertigationArray( fertProgram() ) );
			assert.isFalse( OSApp.Programs.hasFertigationArray( stockProgram() ) );
		} );

		it( "tolerates undefined and empty entries", function() {
			assert.isFalse( OSApp.Programs.hasFertigationArray( undefined ) );
			assert.isFalse( OSApp.Programs.hasFertigationArray( [] ) );
		} );
	} );

	describe( "OSApp.Programs.readProgram21", function() {
		it( "reads the name from index 5 and fertigation from index 8", function() {
			var data = OSApp.Programs.readProgram21( fertProgram() );
			assert.equal( data.name, "Fert Program" );
			assert.deepEqual( data.fertigation, [ 120, 60, 0 ] );
			assert.deepEqual( data.stations, [ 600, 300, 0 ] );
		} );

		it( "reads the name from index 5 and no fertigation for a stock program", function() {
			var data = OSApp.Programs.readProgram21( stockProgram() );
			assert.equal( data.name, "Stock Program" );
			assert.deepEqual( data.fertigation, [] );
			assert.deepEqual( data.stations, [ 600, 300, 0 ] );
		} );
	} );

	describe( "OSApp.Programs.pidToName", function() {
		beforeEach( function() {
			sandbox.stub( OSApp.Firmware, "checkOSVersion" ).returns( true );
		} );

		it( "reads the name from index 5 whether or not fertigation is present", function() {
			OSApp.currentSession.controller.programs.pd = [ fertProgram( { name: "Morning" } ) ];
			assert.equal( OSApp.Programs.pidToName( 1 ), "Morning" );

			OSApp.currentSession.controller.programs.pd = [ stockProgram( { name: "Legacy" } ) ];
			assert.equal( OSApp.Programs.pidToName( 1 ), "Legacy" );
		} );
	} );

	describe( "OSApp.Dates date range indices", function() {
		it( "reads the date range from index 6, with or without fertigation", function() {
			OSApp.currentSession.controller.programs.pd = [
				fertProgram( { daterange: [ 1, 100, 200 ] } )
			];
			assert.deepEqual( OSApp.Dates.getDateRange( 0 ), [ 1, 100, 200 ] );
			assert.equal( OSApp.Dates.isDateRangeEnabled( 0 ), 1 );
			assert.equal( OSApp.Dates.getDateRangeStart( 0 ), 100 );
			assert.equal( OSApp.Dates.getDateRangeEnd( 0 ), 200 );

			OSApp.currentSession.controller.programs.pd = [
				stockProgram( { daterange: [ 1, 100, 200 ] } )
			];
			assert.deepEqual( OSApp.Dates.getDateRange( 0 ), [ 1, 100, 200 ] );
			assert.equal( OSApp.Dates.getDateRangeStart( 0 ), 100 );
		} );

		it( "falls back to the full year when the range is missing", function() {
			OSApp.currentSession.controller.programs.pd = [
				fertProgram( { daterange: undefined } )
			];
			OSApp.currentSession.controller.programs.pd[ 0 ][ 6 ] = undefined;
			assert.equal( OSApp.Dates.isDateRangeEnabled( 0 ), 0 );
			assert.equal( OSApp.Dates.getDateRangeStart( 0 ), OSApp.Dates.Constants.minEncodedDate );
			assert.equal( OSApp.Dates.getDateRangeEnd( 0 ), OSApp.Dates.Constants.maxEncodedDate );
		} );
	} );

	// ---------------------------------------------------- fertigation popup

	describe( "OSApp.UIDom.showFertigationInput", function() {
		afterEach( function() {
			$( "#fertigationInput" ).remove();
		} );

		function open( seconds, stationSeconds ) {
			var got = null;
			OSApp.UIDom.showFertigationInput( {
				seconds: seconds, stationSeconds: stationSeconds,
				callback: function( s ) { got = s; }
			} );
			return {
				pct: $( "#fert-pct" ), sec: $( "#fert-sec" ),
				submit: function() { $( "#fertigationInput input[type=submit]" ).click(); return got; }
			};
		}

		it( "shows both percentage and seconds for an existing value", function() {
			var p = open( 150, 600 );
			assert.equal( p.sec.val(), "150" );
			assert.equal( p.pct.val(), "25" );
		} );

		it( "updates seconds when the percentage is edited", function() {
			var p = open( 0, 600 );
			p.pct.val( 50 ).trigger( "input" );
			assert.equal( p.sec.val(), "300", "50% of 600s = 300s" );
		} );

		it( "updates percentage when seconds are edited", function() {
			var p = open( 0, 600 );
			p.sec.val( 60 ).trigger( "input" );
			assert.equal( p.pct.val(), "10", "60s of 600s = 10%" );
		} );

		it( "clamps seconds to the station run time (guardrail)", function() {
			var p = open( 0, 300 );
			p.sec.val( 900 ).trigger( "input" );
			assert.equal( p.sec.val(), "300", "the seconds field snaps down to the cap" );
			assert.equal( p.pct.val(), "100", "over-long fertigation reads as 100%" );
			assert.equal( p.submit(), 300, "callback receives the clamped seconds" );
		} );

		it( "clamps an over-100 percentage to the station run time", function() {
			var p = open( 0, 600 );
			p.pct.val( 250 ).trigger( "input" );
			assert.equal( p.pct.val(), "100", "the percentage field snaps down to 100" );
			assert.equal( p.sec.val(), "600", "and the seconds field caps at the run time" );
			assert.equal( p.submit(), 600, "callback receives the clamped seconds" );
		} );

		it( "leaves partial input editable rather than forcing it to zero", function() {
			var p = open( 120, 600 );
			p.sec.val( "" ).trigger( "input" );
			assert.equal( p.sec.val(), "", "an emptied field is not clobbered mid-edit" );
			assert.equal( p.pct.val(), "0", "the derived percentage reads as 0 meanwhile" );
		} );

		it( "returns seconds from the callback", function() {
			var p = open( 0, 600 );
			p.pct.val( 20 ).trigger( "input" );
			assert.equal( p.submit(), 120, "20% of 600s = 120s" );
		} );
	} );

	// -------------------------------------------------------- run-once wire

	describe( "run-once fertigation parameters", function() {
		// The fertigation button now holds seconds, not a percentage -- the
		// showFertigationInput popup does the %/seconds conversion and writes
		// seconds back to the button.
		function addRunoncePage( durations, fertSeconds ) {
			var page = $( "<div id='runonce'></div>" ).appendTo( "body" );
			durations.forEach( function( duration, index ) {
				$( "<button></button>" ).attr( "id", "zone-" + index ).val( duration ).appendTo( page );
			} );
			( fertSeconds || [] ).forEach( function( seconds, index ) {
				$( "<button></button>" ).attr( "id", "fert-" + index ).val( seconds ).appendTo( page );
			} );
			$( "<input type='radio' name='wl-runonce'>" ).val( "none" ).prop( "checked", true ).appendTo( page );
			$( "<input id='wl-custom-slider'>" ).val( 100 ).appendTo( page );
			$( "<button id='interval-runonce' value='0'></button>" ).appendTo( page );
			$( "<button id='repeat-runonce' value='0'></button>" ).appendTo( page );
			return page;
		}

		beforeEach( function() {
			sandbox.stub( OSApp.Supported, "repeatedRunonce" ).returns( true );
			sandbox.stub( OSApp.Firmware, "checkOSVersion" ).returns( true );
			sandbox.stub( OSApp.StationQueue, "isActive" ).returns( -1 );
			sandbox.stub( OSApp.Storage, "set" );
			sandbox.stub( OSApp.Status, "refreshStatus" );
			sandbox.stub( OSApp.UIDom, "goBack" );
			sandbox.stub( $.mobile, "loading" );
			sandbox.stub( OSApp.Firmware, "sendToOS" )
				.returns( $.Deferred().resolve( { result: 1 } ).promise() );
		} );

		it( "sends each station's fertigation seconds", function() {
			addRunoncePage( [ 600, 300, 0 ], [ 120, 60, 0 ] );
			OSApp.Stations.submitRunonce( $.Event( "click" ) );

			var request = OSApp.Firmware.sendToOS.getCall( 0 ).args[ 0 ];
			assert.include( request, "&fd0=120" );
			assert.include( request, "&fd1=60" );
		} );

		it( "clamps fertigation seconds to the station's own duration", function() {
			// 900s of fertigation on a 300s run is impossible -- cap it at 300.
			addRunoncePage( [ 300, 0, 0 ], [ 900, 0, 0 ] );
			OSApp.Stations.submitRunonce( $.Event( "click" ) );

			var request = OSApp.Firmware.sendToOS.getCall( 0 ).args[ 0 ];
			assert.include( request, "&fd0=300" );
		} );

		it( "omits stations with no fertigation rather than sending zeros", function() {
			addRunoncePage( [ 600, 300, 0 ], [ 120, 0, 0 ] );
			OSApp.Stations.submitRunonce( $.Event( "click" ) );

			var request = OSApp.Firmware.sendToOS.getCall( 0 ).args[ 0 ];
			assert.include( request, "&fd0=120" );
			assert.notInclude( request, "&fd1=" );
			assert.notInclude( request, "&fd2=" );
		} );

		it( "sends no fertigation parameters when a zone has no duration", function() {
			// clamped to a zero-length run, fertigation is still nothing
			addRunoncePage( [ 0, 0, 0 ], [ 300, 300, 0 ] );
			OSApp.Stations.submitRunonce( $.Event( "click" ) );

			var request = OSApp.Firmware.sendToOS.getCall( 0 ).args[ 0 ];
			assert.notInclude( request, "&fd" );
		} );

		it( "sends no fertigation parameters when the controller lacks support", function() {
			delete OSApp.currentSession.controller.fertigation;
			addRunoncePage( [ 600, 300, 0 ], [ 20, 20, 0 ] );
			OSApp.Stations.submitRunonce( $.Event( "click" ) );

			var request = OSApp.Firmware.sendToOS.getCall( 0 ).args[ 0 ];
			assert.notInclude( request, "&fd" );
		} );
	} );
} );
