# isynnode docker-compose
Dockerized version of the [isynnode solution](https://github.com/exking/isynnode) for integrating the Nest Thermostat API into the
Universal Devices ISY994i platform.

## Prerequisites
- Docker
- Docker Compose
- git

## Files from repository
- Dockerfile
- docker-compose.yml
- package.json

## Setup process
1. Clone jshank/isynnode repository `git clone https://github.com/jshank/isynnode.git`
2. `cd nodeapp`
3. `cp config.json.sample config.json`
4. `cp nestapi.json.sample config.json`
5. Setup a [Nest developer account](https://developers.nest.com/) to get Nest API credentials
6. [Create a product](https://codelabs.developers.google.com/codelabs/wwn-api-quickstart/#2) and capture OAuth Product ID and Product Secret
7. Edit nestapi.json and add your credentials
9. Run `docker-compose up`
11. In your browser, access `http://<docker host ip>:8881`
12. Click on the link to obtain a PIN code, authorize the app and then copy the result to the text box on the page
13. *Optional* If you have multiple thermostats, make note of which number corresponds to which thermostat at the top of the page
14. Open config.json. Create state variables in the UD Admin Console for each of the fields you want to capture (temp, humidity, etc).
15. Edit config.json and setup the variables to match your UD Admin Console:
```javascript
{
       "isy": {
           "0": { // thermostat number if you have multiples (see the node web page after you have authenticated for a list of which thermostat number is which location
               "temperature": { // temperature will be stored in this variable
                   "type": 2, // Type 1 for integer or 2 for state (you can only trigger isy programs on state)
                   "num": 6 // The variable ID (not name) from the variables tab in UD Admin Console
               },
<snip>
```
16. At the bottom of config.json, enter the credentials for your isy994i (if you want variables updated)

**Still a work in progress**
