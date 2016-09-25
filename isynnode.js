/*
	ISYNNode by Andrey Pevnev
	Version 0.0.5 
*/

var http = require('http');
var https = require('https');
var Firebase = require('firebase');
var express = require('express');
var querystring = require('querystring');
var app = express();
var fs = require('fs');
var keepAliveAgent = new http.Agent({ keepAlive: true });
var winston = require('winston');
var work = {};
var config = {};
var gFirstRun = true;
	
var dataRef = new Firebase('wss://developer-api.nest.com');

var logger = new (winston.Logger)({
	transports: [
		new (winston.transports.Console)({'timestamp':true})
	]
});

function isy_setvar(varObj, value) {
	if (!config.isy.user || !config.isy.pass) {
		logger.error("ISY credentials missing");
		return;
	}	

	if (!varObj) {
//		logger.error("ISY variable undefined");
		return;
	}	

	var get_options = {
		hostname: config.isy.host || 'isy',
		port: config.isy.port || 80,
		path: '/rest/vars/set/'+varObj.type+'/'+varObj.num+'/'+value,
		method: 'GET',
		auth: config.isy.user+":"+config.isy.pass,
		agent: keepAliveAgent
	}
	
	var req = http.request(get_options, function(res) {
		if (res.statusCode == 200) {
			res.setEncoding('utf8');
  		} else {
  			logger.error("ISY variable set error: "+res.statusCode);
  		}	
	});

	req.on('error', function(e) {
		logger.error('problem with request: ' + e.message);
	});
	req.end();
}

function nestGetToken(object) {
	logger.info("Attempting to obtain a new auth_token");

   	var post_data = querystring.stringify({
    	'client_id' : nest_api.client_id,
    	'code' : config.auth_pin,
    	'client_secret' : nest_api.client_secret,
    	'grant_type' : 'authorization_code'
	});
	
	var post_options = {
		host: 'api.home.nest.com',
		port: '443',
		path: '/oauth2/access_token',
		method: 'POST',
		headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': post_data.length
		}
	}
	
	var post_req = https.request(post_options, function(res) {
		var result = "";
		var ts = new Date();			
		if (res.statusCode == 200)
		{			
			res.setEncoding('utf8');
			
			res.on('data', function (chunk) {
				result += chunk;
			});
				
			res.on('end', function () {
				var auth_data = JSON.parse(result);		
				object.auth_token = auth_data.access_token;
				object.token_expires = ts.getTime() + auth_data.expires_in*1000;
				nestLogin(object);
			});
		} else {
			logger.error("ERROR getting authentication data, exiting...", res.statusCode);
			process.exit(1);
		}		
	});
	
	post_req.on('error', function(e) {
		logger.error("ERROR getting authenticatio data, exiting...");
		console.error(e);	
		process.exit(1);
	});

	// post the data
	post_req.write(post_data);
	post_req.end();	
}

function nestRevokeToken(object) {
	logger.info("Revoking existing auth_token");
	
	var revoke_options = {
		host: 'api.home.nest.com',
		port: '443',
		path: '/oauth2/access_tokens/'+object.auth_token,
		method: 'DELETE'
	}
	
	var revoke_req = https.request(revoke_options, function(res) {
		if (res.statusCode == 204 || res.statusCode == 200 )
		{
			dataRef.off();
			dataRef.offAuth(nestAuthChange);
			dataRef.unauth();
			object.auth_token='';
			saveStatus(object);
			logger.info("Revoke complete");
		} else {
			logger.error("ERROR revoking a token", res.statusCode);
		}		
	});
	
	revoke_req.on('error', function(e) {
		logger.error("ERROR getting authenticatio data, exiting...");
		console.error(e);	
		process.exit(1);
	});
	
	revoke_req.end();	
}

function nestAuthChange(authData) {
	if (authData) {
		logger.info("Client authenticated.");
	} else {
		logger.info("Client unauthenticated, will re-try in 5 minutes.")
		setTimeout(nestReLogin, 300000); 
	}
}

function nestReLogin() {
	logger.info("Re-Login called");
	if ((work.auth_token != '') && !dataRef.getAuth()) {
		logger.info("Attempting to re-login");
		dataRef.authWithCustomToken(work.auth_token, function(error, authData) {
  			if (error) {
    			logger.error("ReAuthentication Failed!", error.code);
				setTimeout(nestReLogin, 300000); 
 	 		} else {
   	 			logger.info("ReAuthenticated successfully");
 	 		}
		});
	}
}

function nestLogin(object) {
	dataRef.authWithCustomToken(object.auth_token, function(error, authData) {
  		if (error) {
    			logger.error("Authentication Failed!", error.code);
  		} else {
    			logger.info("Authenticated successfully");
    		dataRef.on('value', nestUpdate);
		dataRef.onAuth(nestAuthChange);
  		}
	});
}

function saveStatus(object) {
    fs.writeFile("status.json", JSON.stringify(object, null, 4), function (err) {
    	if (err) logger.error("ERROR writing status.json")
    });
}

function nestUpdate(snapshot) {
	var data = snapshot.val();
	var i = 0;
	var hvacStates = ["off", "heating", "cooling"];
	var hvacModes = ["off", "heat", "cool", "heat-cool"];
	var structAway = ["home", "away", "auto-away", "unknown"];
	var isChange = false;
	var currentTS = new Date();

	if (!work.structure) {
		work.thermostat = [];
		work.thermostats = [];
		logger.info("looking for thermostats...");
		
		for (var key in data.structures) {
			work.structure = data.structures[key].structure_id;
			break;
		}
	    logger.info("Structure ID: " + work.structure);
	    			    
        data.structures[work.structure].thermostats.forEach(function (entry) {
 			work.thermostat[i] = entry;
 			logger.info("Thermostat ID["+i+"]: " + entry);
 			i++;
 			});
 		logger.info("Found "+i+" thermostats...");
 		i=0;
 		work.thermostat.forEach(function (entry) { 		
			work.thermostats.push({
				"device_id": entry,
				"name": data.devices.thermostats[entry].name,
				"ambient_temperature_f": data.devices.thermostats[entry].ambient_temperature_f,
				"ambient_temperature_c": data.devices.thermostats[entry].ambient_temperature_c,
				"humidity": data.devices.thermostats[entry].humidity,
				"hvac_state": data.devices.thermostats[entry].hvac_state,
				"is_using_emergency_heat": data.devices.thermostats[entry].is_using_emergency_heat,
				"hvac_mode": data.devices.thermostats[entry].hvac_mode,
				"is_online": data.devices.thermostats[entry].is_online,
				"target_temperature_f": data.devices.thermostats[entry].target_temperature_f,
				"target_temperature_c": data.devices.thermostats[entry].target_temperature_c,
				"target_temperature_low_f": data.devices.thermostats[entry].target_temperature_low_f,
				"target_temperature_low_c": data.devices.thermostats[entry].target_temperature_low_c,				
				"target_temperature_high_f": data.devices.thermostats[entry].target_temperature_high_f,
				"target_temperature_high_c": data.devices.thermostats[entry].target_temperature_high_c,
				"fan_timer_active": data.devices.thermostats[entry].fan_timer_active,
				"last_connection": data.devices.thermostats[entry].last_connection,
				"temperature_scale": data.devices.thermostats[entry].temperature_scale
			});
			if (config.isy && gFirstRun == true) {
				isy_setvar(config.isy[i]['temperature'], data.devices.thermostats[entry].ambient_temperature_f);
				isy_setvar(config.isy[i]['humidity'], data.devices.thermostats[entry].humidity);
				isy_setvar(config.isy[i]['state'], hvacStates.indexOf(data.devices.thermostats[entry].hvac_state));
				isy_setvar(config.isy[i]['mode'], hvacModes.indexOf(data.devices.thermostats[entry].hvac_mode));
				isy_setvar(config.isy[i]['settemp'], data.devices.thermostats[entry].target_temperature_f);
				isy_setvar(config.isy[i]['setlow'], data.devices.thermostats[entry].target_temperature_low_f);
				isy_setvar(config.isy[i]['sethigh'], data.devices.thermostats[entry].target_temperature_high_f);
			}	
			i++;
 		});
 		work.away = data.structures[work.structure].away;
 		if (config.isy && gFirstRun == true) {
 			isy_setvar(config.isy['S']['away'], structAway.indexOf(data.structures[work.structure].away));
 		}
 		work.rush_hour = false;
 		isChange = true;
	 } else {
	 	if (work.away != data.structures[work.structure].away) {
 			// call update here	
 			// logger.info("away: "+work.away+"->"+data.structures[work.structure].away);	
 			if (config.isy) {
 				isy_setvar(config.isy['S']['away'], structAway.indexOf(data.structures[work.structure].away));
 			}	
 			work.away = data.structures[work.structure].away;
 			isChange = true;
 		}
 		// See if we are enrolled in RHR and it's actually a rush hour
 		if (snapshot.child("structures/"+work.structure+"/peak_period_start_time").exists() &&
 		    snapshot.child("structures/"+work.structure+"/peak_period_end_time").exists() )
 		{
 			var rhStartTS = new Date(data.structures[work.structure].peak_period_start_time);
 			var rhEndTS   = new Date(data.structures[work.structure].peak_period_end_time);
 			
 			work.rh_start = data.structures[work.structure].peak_period_start_time;
 			work.rh_end = data.structures[work.structure].peak_period_end_time;
 			
 			if ((currentTS >= rhStartTS) && (currentTS <= rhEndTS))
 			{
 				if (work.rush_hour == false)
 				{
 					work.rush_hour = true;
 					isy_setvar(config.isy['S']['rush_hour'], 1);
 					isChange = true;
 				}
 			}
 			else
 			{
 			 	if (work.rush_hour == true)
 				{
 					work.rush_hour = false;
 					isy_setvar(config.isy['S']['rush_hour'], 0);
 					isChange = true;
 				}
 			} 			
 		}
 		else
 		{
 		 	if (work.rush_hour == true)
 			{
 				work.rush_hour = false;
 				isy_setvar(config.isy['S']['rush_hour'], 0);
 				isChange = true;
 			}
 		} /* End of Rush Hour check */
 		work.thermostat.forEach(function (entry) {
			if (work.thermostats[i].ambient_temperature_f != data.devices.thermostats[entry].ambient_temperature_f ||
				gFirstRun == true ) {
				// call update here
				if (config.isy) {
					isy_setvar(config.isy[i]['temperature'], data.devices.thermostats[entry].ambient_temperature_f);
				}	
				work.thermostats[i].ambient_temperature_f = data.devices.thermostats[entry].ambient_temperature_f;
				isChange = true;
			}	
			if (work.thermostats[i].ambient_temperature_c != data.devices.thermostats[entry].ambient_temperature_c ||
				gFirstRun == true ) {
				// call update here
				// if (config.isy) {
				//	isy_setvar(config.isy[i]['temperature'], data.devices.thermostats[entry].ambient_temperature_f);
				// }	
				work.thermostats[i].ambient_temperature_c = data.devices.thermostats[entry].ambient_temperature_c;
				isChange = true;
			}				
			if (work.thermostats[i].humidity != data.devices.thermostats[entry].humidity ||
				gFirstRun == true ) {			
				// call update here	
				if (config.isy) {			
					isy_setvar(config.isy[i]['humidity'], data.devices.thermostats[entry].humidity);
				}
				work.thermostats[i].humidity = data.devices.thermostats[entry].humidity;
				isChange = true;
			}	
			if (work.thermostats[i].hvac_state != data.devices.thermostats[entry].hvac_state ||
				gFirstRun == true ) {			
				// call update here	
				if (config.isy) {
					isy_setvar(config.isy[i]['state'], hvacStates.indexOf(data.devices.thermostats[entry].hvac_state));
				}	
				work.thermostats[i].hvac_state = data.devices.thermostats[entry].hvac_state;
				isChange = true;
			}
			if (work.thermostats[i].is_using_emergency_heat != data.devices.thermostats[entry].is_using_emergency_heat ||
				gFirstRun == true ) {			
				// call update here	
				work.thermostats[i].is_using_emergency_heat = data.devices.thermostats[entry].is_using_emergency_heat;
				isChange = true;
			}	 	
			if (work.thermostats[i].hvac_mode != data.devices.thermostats[entry].hvac_mode ||
				gFirstRun == true ) {			
				// call update here	
				if (config.isy) {
					isy_setvar(config.isy[i]['mode'], hvacModes.indexOf(data.devices.thermostats[entry].hvac_mode));
				}	
				work.thermostats[i].hvac_mode = data.devices.thermostats[entry].hvac_mode;
				isChange = true;
			}	 	
			if (work.thermostats[i].is_online != data.devices.thermostats[entry].is_online ||
				gFirstRun == true ) {			
				// call update here	
				work.thermostats[i].is_online = data.devices.thermostats[entry].is_online;
				isChange = true;
			}	 	
			if (work.thermostats[i].target_temperature_f != data.devices.thermostats[entry].target_temperature_f ||
				gFirstRun == true ) {			
				// call update here
				if (config.isy) {			
					isy_setvar(config.isy[i]['settemp'], data.devices.thermostats[entry].target_temperature_f);
				}	
				work.thermostats[i].target_temperature_f = data.devices.thermostats[entry].target_temperature_f;
				isChange = true;
			}	 	
			if (work.thermostats[i].target_temperature_c != data.devices.thermostats[entry].target_temperature_c ||
				gFirstRun == true ) {			
				// call update here
				//if (config.isy) {			
				//	isy_setvar(config.isy[i]['settemp'], data.devices.thermostats[entry].target_temperature_c);
				//}	
				work.thermostats[i].target_temperature_c = data.devices.thermostats[entry].target_temperature_c;
				isChange = true;
			}	 				
			if (work.thermostats[i].target_temperature_low_f != data.devices.thermostats[entry].target_temperature_low_f ||
				gFirstRun == true ) {			
				// call update here	
				if (config.isy) {			
					isy_setvar(config.isy[i]['setlow'], data.devices.thermostats[entry].target_temperature_low_f);
				}	
				work.thermostats[i].target_temperature_low_f = data.devices.thermostats[entry].target_temperature_low_f;
				isChange = true;
			}
			if (work.thermostats[i].target_temperature_low_c != data.devices.thermostats[entry].target_temperature_low_c ||
				gFirstRun == true ) {			
				// call update here	
				//if (config.isy) {			
				//	isy_setvar(config.isy[i]['setlow'], data.devices.thermostats[entry].target_temperature_low_f);
				//}	
				work.thermostats[i].target_temperature_low_c = data.devices.thermostats[entry].target_temperature_low_c;
				isChange = true;
			}
			if (work.thermostats[i].target_temperature_high_f != data.devices.thermostats[entry].target_temperature_high_f ||
				gFirstRun == true ) {			
				// call update here	
				if (config.isy) {			
					isy_setvar(config.isy[i]['sethigh'], data.devices.thermostats[entry].target_temperature_high_f);
				}	
				work.thermostats[i].target_temperature_high_f = data.devices.thermostats[entry].target_temperature_high_f;
				isChange = true;
			}	 	
			if (work.thermostats[i].target_temperature_high_c != data.devices.thermostats[entry].target_temperature_high_c ||
				gFirstRun == true ) {			
				// call update here	
				//if (config.isy) {			
				//	isy_setvar(config.isy[i]['sethigh'], data.devices.thermostats[entry].target_temperature_high_f);
				//}	
				work.thermostats[i].target_temperature_high_c = data.devices.thermostats[entry].target_temperature_high_c;
				isChange = true;
			}	 				
			if (work.thermostats[i].fan_timer_active != data.devices.thermostats[entry].fan_timer_active ||
				gFirstRun == true ) {			
				// call update here	
				work.thermostats[i].fan_timer_active = data.devices.thermostats[entry].fan_timer_active;
				isChange = true;
			}	 	
			if (work.thermostats[i].last_connection != data.devices.thermostats[entry].last_connection ||
				gFirstRun == true ) {			
				// call update here	
				work.thermostats[i].last_connection = data.devices.thermostats[entry].last_connection;
				isChange = true;
			}	 	
			if (work.thermostats[i].temperature_scale != data.devices.thermostats[entry].temperature_scale ||
				gFirstRun == true ) {			
				// call update here	
				work.thermostats[i].temperature_scale = data.devices.thermostats[entry].temperature_scale;
				isChange = true;
			}	 	
		 	i++;
	 	});
	 }	
 	if (isChange == true) saveStatus(work);
 	if (gFirstRun == true) gFirstRun = false;
}

function nestSetTemp(object, id, newTemp, scale, type) {
	scale = scale.toLowerCase();
	type = type ? type + '_' : '';
	var path = 'devices/thermostats/' + object.thermostat[id] + '/target_temperature_' + type + scale;
	
    if (!object.thermostats[id].device_id) {
  		logger.error("Wrong thermostat id: "+req.params.id);
	} else if (object.thermostats[id].is_using_emergency_heat) {
		logger.error("Can't adjust target temperature while using emergency heat.");
	} else if (!object.thermostats[id].is_online) {
		logger.error("Can't adjust target temperature, thermostat is offline ");
	} else if (object.thermostats[id].hvac_mode === 'heat-cool' && !type) {
		logger.error("Can't adjust target temperature while in Heat • Cool mode, use target_temperature_high/low instead.");
	} else if (type && object.thermostats[id].hvac_mode !== 'heat-cool') {
		logger.error("Can't adjust target temperature " + type + " while in " + object.thermostats[id].hvac_mode +  " mode, use target_temperature instead.");
	} else if (object.away === "away") {
		logger.error("Can't adjust target temperature while structure is set to Away or Auto-away.");
	} else { // ok to set target temperature
		dataRef.child(path).set(parseInt(newTemp), onSetError);
	}
}

function nestSetMode(object, id, newMode) {
	var path = 'devices/thermostats/' + object.thermostat[id] + '/hvac_mode';
	var hvacModes = ["off", "heat", "cool", "heat-cool"];

    if (!object.thermostats[id].device_id) {
  		logger.error("Wrong thermostat id: "+req.params.id);
	} else if (object.thermostats[id].is_using_emergency_heat) {
		logger.error("Can't set mode while using emergency heat.");
	} else if (hvacModes.indexOf(newMode) == -1) {
		logger.error("Wrong HVAC mode: " + newMode);
	} else if (!object.thermostats[id].is_online) {
		logger.error("Can't adjust target temperature, thermostat is offline ");
	} else { // ok to set target temperature
		dataRef.child(path).set(newMode, onSetError);
	}
}

function nestHomeAway(object, newMode) {
	var path = 'structures/' + object.structure + '/away';
		
	if (newMode == "away" || newMode == "home") {
		dataRef.child(path).set(newMode, onSetError);
	} else {
		logger.error("unrecognized new mode: "+ newMode);
	}	
}

function nestSetFan(object, id, fanMode) {
	var path = 'devices/thermostats/' + object.thermostat[id] + '/fan_timer_active';
	
    if (!object.thermostats[id].device_id) {
  		logger.error("Wrong thermostat id: "+req.params.id);
	} else if (object.thermostats[id].is_using_emergency_heat) {
		logger.error("Can't set fan mode while using emergency heat.");
	} else if (!object.thermostats[id].is_online) {
		logger.error("Can't set fan mode, thermostat is offline ");
	} else if (object.away === "away") {
		logger.error("Can't set fan mode while structure is set to Away or Auto-away.");
	} else { // ok to set fan timer	
		dataRef.child(path).set(fanMode, onSetError);
	}
}

function onSetError(error)
{
	if (error) {
		logger.error("OnSet error: " + error.code);
	}
}

// Processing begins
try {
	nest_api = JSON.parse(fs.readFileSync("nestapi.json", "utf8"));
} catch (err ) {
	logger.error("nestapi.json MUST be present in the current directory and MUST contain the valid identity");
	process.exit();
}
if ( !nest_api.client_secret || !nest_api.client_id )	
	{ 
	logger.error("nestapi.json MUST be present in the current directory and MUST contain the valid identity");
	process.exit();
       	}

config = JSON.parse(fs.readFileSync("config.json", "utf8"));
if (!config.scale) { config.scale = 'F'; }

// Setup EXPRESS
app.get('/', function (req, res) {
	var textOut = "<html><head></head><body>";	
	var i = 0;
	var host = server.address().address;
	var port = server.address().port;
	if (work.auth_token != '') {
		textOut += "Structure: "+work.structure+"<br/>";
		work.thermostat.forEach(function (entry) {
			textOut += "Thermostat["+i+"]: "+work.thermostats[i].name+"<br/>";
			i++;		
		});
		textOut += "<br/>";	
		textOut += "If you want to revoke the existing token: use this <a href=\"/revoke\">link</a>";
		textOut += "<p>Commands supported:</p>";
		textOut += "<p><b>http://"+host+":"+port+"/settemp/ID/tt</b> - sets thermostat's ID temperature to tt in heat or cool mode</p>";
		textOut += "<p><b>http://"+host+":"+port+"/setlow/ID/tt</b> - sets thermostat's ID heating temperature to tt in heat-cool mode</p>";
		textOut += "<p><b>http://"+host+":"+port+"/sethigh/ID/tt</b> - sets thermostat's ID heating temperature to tt in heat-cool mode</p>";
		textOut += "<p><b>http://"+host+":"+port+"/setmode/ID/mm</b> - sets thermostat's ID mode to mm, choice of <b>{off, heat, cool, heat-cool}</b>, ID can be substituted with <b>all</b></p>";
		textOut += "<p><b>http://"+host+":"+port+"/setfan/ID/ff</b> - sets thermostat's ID fan timer to ff, choice of <b>{off, on}</b></p>";
		textOut += "<p><b>http://"+host+":"+port+"/setaway/aa</b> - sets structures's away mode to aa, choice of <b>{home, away}</b></p>";
		textOut += "<p><b>http://"+host+":"+port+"/refresh</b> - updates all ISY variables on next event</p>";
		textOut += "<p><b>http://"+host+":"+port+"/reconfig</b> - re-reads config.json</p>";
		textOut += "<p><b>http://"+host+":"+port+"/stop</b> - terminates the app</p>";				
	} else {
		textOut += "Please use this <a target=\"_blank\" href=\"https://home.nest.com/login/oauth2?client_id="+nest_api.client_id+"&state=STATE\">link</a> ";
		textOut += "to obtain a PIN code<br/>";
		textOut += "<form action=\"/newpin\" method=\"get\">";
		textOut += "Enter it here: ";
		textOut += "<input type=\"text\" name=\"newpin\">";
		textOut += "<br>";
		textOut += "<input type=\"submit\" value=\"Submit\">";
		textOut += "</form>";
	}	
	textOut += "</body></html>";
	res.send(textOut);
});

app.get('/newpin', function (req, res) {
	var textOut = "<html><head><meta http-equiv=\"refresh\" content=\"5;URL=/\"></head><body>";
	textOut += "Accepted PIN: "+req.query.newpin;
	textOut += "</body></html>";
	res.send(textOut);
	config.auth_pin=req.query.newpin;
	nestGetToken(work);
});

app.get('/revoke', function (req, res) {
	var textOut = "<html><head><meta http-equiv=\"refresh\" content=\"3;URL=/\"></head><body>";
	nestRevokeToken(work);	
	textOut += "Revoke request has been sent<br/>";
	textOut += "</body></html>";
	res.send(textOut);
});

app.get('/reconfig', function (req, res) {
	var textOut = "<html><head><meta http-equiv=\"refresh\" content=\"3;URL=/\"></head><body>";
	fs.readFile("config.json", "utf8", function (err, data) {
		if (err) {
			logger.error("failure to re-read config.json");
		} else {
			logger.info("re-reading the configuration");
			config = JSON.parse(data);
		}	
	});
	textOut += "configuration re-read is complete<br/>";
	textOut += "</body></html>";
	res.send(textOut);
});

app.get('/refresh', function (req, res) {
	var textOut = "<html><head><meta http-equiv=\"refresh\" content=\"3;URL=/\"></head><body>";
	textOut += "ISY will be refreshed<br/>";
	textOut += "</body></html>";
	gFirstRun = true;
	res.send(textOut);
});

app.get('/settemp/:id/:temp', function (req, res) {
	if (work.auth_token != '') {
		res.send('ID: '+req.params.id+'Temp: '+req.params.temp);
		nestSetTemp(work, req.params.id, req.params.temp, 'F');
	} else {
		res.send("No token");
	}		
});

app.get('/setlow/:id/:temp', function (req, res) {
	if (work.auth_token != '') {
		if (req.params.temp < work.thermostats[req.params.id].target_temperature_high_f) {
			res.send('ID: '+req.params.id+'Temp: '+req.params.temp);
			nestSetTemp(work, req.params.id, req.params.temp, 'F', 'low');
		} else {
			res.send("Low can't be larger than high");
		}
	} else {
		res.send("No token");
	}				
});

app.get('/sethigh/:id/:temp', function (req, res) {
	if (work.auth_token != '') {
		res.send('ID: '+req.params.id+'Temp: '+req.params.temp);
		nestSetTemp(work, req.params.id, req.params.temp, 'F', 'high');
	} else {
		res.send("No token");
	}				
});

app.get('/setmode/:id/:mode', function (req, res) {
	if (work.auth_token != '') {
		res.send('ID: '+req.params.id+'Mode: '+req.params.mode);	
		if ((req.params.id == -1) || (req.params.id === "all")) {
			for (var i=0; i < work.thermostat.length; i++)
			{
				nestSetMode(work, i, req.params.mode);
			}
		} else {
  			nestSetMode(work, req.params.id, req.params.mode);
		}
	} else {
		res.send("No token");
	}				
});

app.get('/setaway/:away', function (req, res) {
	if (work.auth_token != '') {
		nestHomeAway(work, req.params.away);
		res.send('Mode: '+req.params.away);
	} else {
		res.send("No token");
	}				
});

app.get('/setfan/:id/:mode', function (req, res) {
	if (work.auth_token != '') {
		res.send('ID: '+req.params.id+'Mode: '+req.params.mode);
		switch (req.params.mode) {
			case 'on':
				nestSetFan(work, req.params.id, true);
				break;
			case 'off':
				nestSetFan(work, req.params.id, false);
				break;
			default:
				logger.error("Invalid FAN mode requested");
				break;	
		}
	} else {
		res.send("No token");
	}				
});

app.get('/status', function (req, res) {
		res.send(JSON.stringify(work, null, 4));
});

// Load the working structure
fs.readFile("status.json", "utf8", function(err, data) {
	if (err) {
		logger.info("status.json does not seem to exist");
		work.auth_token='';
	} else {
		work = JSON.parse(data);
		logger.info("using saved status.json");		
		if (work.auth_token && work.token_expires) {
			var tsExp = new Date(work.token_expires);
			var tsNow = new Date();
			
			if (tsExp > tsNow ) {
				logger.info("Using the existing token, valid until: " + tsExp);
				nestLogin(work);
			} else {
				logger.info("Existing token seems to be expired");
				work.auth_token='';
			}			
		}
	}					
});

app.get('/stop', function (req, res) {
	logger.info("exit requested");
	res.send('Bye...');
	dataRef.off();
	dataRef.offAuth(nestAuthChange);
	dataRef.unauth();
	process.exit();
});

app.get('*', function(req, res) {
	res.status(404);
	res.send('Not Found');
	logger.error("Unknown request: "+req.url);
});

var server = app.listen(config.server_port || 8881, function () {
	var host = server.address().address;
	var port = server.address().port;
	logger.info('Listening at http://%s:%s', host, port);
});			
