/* eslint-disable */

describe( "Fertigation Checks", function() {
	var controller;
	var sandbox;

	// A program entry as the firmware emits it once fertigation is supported:
	// the fertigation array sits at index 5, which pushes the name to 6 and the
	// date range to 7. Stock firmware has the name at 5 and the range at 6.
	function newFormatProgram( opts ) {
		opts = opts || {};
		return [
			opts.flag === undefined ? 65 : opts.flag,
			127, 0,
			[ 360, -1, -1, -1 ],
			opts.durations || [ 600, 300, 0 ],
			opts.fertigation || [ 120, 60, 0 ],
			opts.name === undefined ? "New Format" : opts.name,
			opts.daterange || [ 1, 33, 415 ]
		];
	}

	function oldFormatProgram( opts ) {
		opts = opts || {};
		return [
			opts.flag === undefined ? 65 : opts.flag,
			127, 0,
			[ 360, -1, -1, -1 ],
			opts.durations || [ 600, 300, 0 ],
			opts.name === undefined ? "Old Format" : opts.name,
			opts.daterange || [ 1, 33, 415 ]
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
		it( "detects the fertigation format from the payload, not the controller", function() {
			assert.isTrue( OSApp.Programs.hasFertigationArray( newFormatProgram() ) );
			assert.isFalse( OSApp.Programs.hasFertigationArray( oldFormatProgram() ) );
		} );

		it( "still detects an old-format payload while the controller supports fertigation", function() {
			// This is the case the previous capability-based check got wrong: a
			// program object cached before the controller finished loading.
			assert.isTrue( OSApp.Supported.fertigation() );
			assert.isFalse( OSApp.Programs.hasFertigationArray( oldFormatProgram() ) );
		} );

		it( "tolerates undefined and empty entries", function() {
			assert.isFalse( OSApp.Programs.hasFertigationArray( undefined ) );
			assert.isFalse( OSApp.Programs.hasFertigationArray( [] ) );
		} );
	} );

	describe( "OSApp.Programs.readProgram21", function() {
		it( "reads fertigation from 5 and the name from 6 in the new format", function() {
			var data = OSApp.Programs.readProgram21( newFormatProgram() );
			assert.deepEqual( data.fertigation, [ 120, 60, 0 ] );
			assert.equal( data.name, "New Format" );
			assert.deepEqual( data.stations, [ 600, 300, 0 ] );
		} );

		it( "reads the name from 5 and no fertigation in the old format", function() {
			var data = OSApp.Programs.readProgram21( oldFormatProgram() );
			assert.deepEqual( data.fertigation, [] );
			assert.equal( data.name, "Old Format" );
			assert.deepEqual( data.stations, [ 600, 300, 0 ] );
		} );
	} );

	describe( "OSApp.Programs.pidToName", function() {
		beforeEach( function() {
			sandbox.stub( OSApp.Firmware, "checkOSVersion" ).returns( true );
		} );

		it( "takes the name from index 6 in the new format", function() {
			OSApp.currentSession.controller.programs.pd = [ newFormatProgram( { name: "Morning" } ) ];
			assert.equal( OSApp.Programs.pidToName( 1 ), "Morning" );
		} );

		it( "takes the name from index 5 in the old format", function() {
			OSApp.currentSession.controller.programs.pd = [ oldFormatProgram( { name: "Legacy" } ) ];
			assert.equal( OSApp.Programs.pidToName( 1 ), "Legacy" );
		} );
	} );

	describe( "OSApp.Dates date range indices", function() {
		it( "reads the date range from index 7 in the new format", function() {
			OSApp.currentSession.controller.programs.pd = [
				newFormatProgram( { daterange: [ 1, 100, 200 ] } )
			];
			assert.deepEqual( OSApp.Dates.getDateRange( 0 ), [ 1, 100, 200 ] );
			assert.equal( OSApp.Dates.isDateRangeEnabled( 0 ), 1 );
			assert.equal( OSApp.Dates.getDateRangeStart( 0 ), 100 );
			assert.equal( OSApp.Dates.getDateRangeEnd( 0 ), 200 );
		} );

		it( "reads the date range from index 6 in the old format", function() {
			OSApp.currentSession.controller.programs.pd = [
				oldFormatProgram( { daterange: [ 1, 100, 200 ] } )
			];
			assert.deepEqual( OSApp.Dates.getDateRange( 0 ), [ 1, 100, 200 ] );
			assert.equal( OSApp.Dates.getDateRangeStart( 0 ), 100 );
		} );

		it( "falls back to the full year when the range is missing", function() {
			OSApp.currentSession.controller.programs.pd = [
				newFormatProgram( { daterange: undefined } )
			];
			OSApp.currentSession.controller.programs.pd[ 0 ][ 7 ] = undefined;
			assert.equal( OSApp.Dates.isDateRangeEnabled( 0 ), 0 );
			assert.equal( OSApp.Dates.getDateRangeStart( 0 ), OSApp.Dates.Constants.minEncodedDate );
			assert.equal( OSApp.Dates.getDateRangeEnd( 0 ), OSApp.Dates.Constants.maxEncodedDate );
		} );
	} );

	// -------------------------------------------------------- run-once wire

	describe( "run-once fertigation parameters", function() {
		function addRunoncePage( durations, fertPercents ) {
			var page = $( "<div id='runonce'></div>" ).appendTo( "body" );
			durations.forEach( function( duration, index ) {
				$( "<button></button>" ).attr( "id", "zone-" + index ).val( duration ).appendTo( page );
			} );
			( fertPercents || [] ).forEach( function( percent, index ) {
				$( "<button></button>" ).attr( "id", "fert-" + index ).val( percent ).appendTo( page );
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

		it( "converts each percentage to seconds of the station's own duration", function() {
			// 20% of 600s = 120s, 20% of 300s = 60s
			addRunoncePage( [ 600, 300, 0 ], [ 20, 20, 0 ] );
			OSApp.Stations.submitRunonce( $.Event( "click" ) );

			var request = OSApp.Firmware.sendToOS.getCall( 0 ).args[ 0 ];
			assert.include( request, "&fd0=120" );
			assert.include( request, "&fd1=60" );
		} );

		it( "omits stations with no fertigation rather than sending zeros", function() {
			addRunoncePage( [ 600, 300, 0 ], [ 20, 0, 0 ] );
			OSApp.Stations.submitRunonce( $.Event( "click" ) );

			var request = OSApp.Firmware.sendToOS.getCall( 0 ).args[ 0 ];
			assert.include( request, "&fd0=120" );
			assert.notInclude( request, "&fd1=" );
			assert.notInclude( request, "&fd2=" );
		} );

		it( "sends no fertigation parameters when a zone has no duration", function() {
			// 50% of nothing is still nothing
			addRunoncePage( [ 0, 0, 0 ], [ 50, 50, 0 ] );
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
