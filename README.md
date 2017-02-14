# isynnode
Simple nodes project that allows ISY home automation system to integrate with the NEST thermostat

It's NODE.JS now so you'll need to make sure that your Pi has it. To check just run this command:

node --version

That should return something like v7.5.0 (script should run with ANY node.js version)
If it says node is not found - you'll need to find out how to install NODE.JS on your Pi.

Unzip the file - you should see a folder named isynnode and a couple of files in there - config.json.sample is something you may want to copy to config.json and edit - it has an isy address, username, password and variable types and numbers. Variables are only needed if you want scrip to update ISY on your Nest status. I have 2 thermostats - therefore there are sections 0 and 1.

my script depends on a few node.js modules which you need to install. while inside the isynnode folder run the following commands:

npm install express
npm install firebase
npm install winston

then you should be able to run it like

node isynnode.js > log.txt 2>&1 &

That should just run it in background, check log.txt for any errors/exceptions.

If it's running OK - navigate to http://rpi:8881/ (assuming rpi is your Raspberry Pi address) - it will prompt you to authenticate with Nest and once authenticated - it will show the quick command help.

Also check out the status.json it creates - that should have your Nest data.

Let me know if that works for you and good luck!

P.S. Current limitations:
1) Only one structure is supported so far.
2) Nests can't be locked - otherwise the only function will be Away/Home setting - that is the NEST API limitation.
