const Alexa = require('alexa-sdk');
const request = require('request-promise-native');
const moment = require('moment');

exports.handler = function(event, context, callback) {
  const alexa = Alexa.handler(event, context);
  alexa.appId = process.env.ALEXA_APP_ID;
  alexa.registerHandlers(handlers);
  alexa.execute();
};

const handlers = {
  'LaunchRequest': launchRequestHandler,
  'AMAZON.StopIntent': stopIntentHandler,
  'AMAZON.CancelIntent': cancelIntentHandler,
  'AMAZON.HelpIntent': helpIntentHandler,
  'SlackAwayIntent': slackAwayIntentHandler,
  'SlackStatusIntent': slackStatusIntentHandler,
  'SlackClearStatusIntent': slackClearStatusIntentHandler,
  'SlackSnoozeIntent': slackSnoozeIntentHandler,
  'Unhandled': unhandledIntentHandler,
};

const statuses = {
  lunch: {
    status_text: 'Out for lunch',
    status_emoji: ':taco:'
  },
  coffee: {
    status_text: 'Out for coffee',
    status_emoji: ':coffee:'
  },
  busy: {
    status_text: 'Do not disturb',
    status_emoji: ':no_entry_sign:'
  },
  errand: {
    status_text: 'Running an errand',
    status_emoji: ':running:'
  },
  doctor: {
    status_text: 'Doctor\'s appointment',
    status_emoji: ':face_with_thermometer:'
  },
  away: {
    status_text: 'AFK',
    status_emoji: ':no_entry_sign:'
  },
  call: {
    status_text: 'On a call',
    status_emoji: ':slack_call:'
  },
  meeting: {
    status_text: 'In a meeting',
    status_emoji: ':calendar:'
  },
  sick: {
    status_text: 'Out sick',
    status_emoji: ':face_with_thermometer:'
  },
  commuting: {
    status_text: 'Commuting',
    status_emoji: ':bus:'
  }
};

/**
 * Handles launch requests, i.e. "Alexa, open [app name]".
 */
function launchRequestHandler() {
  let access_token = this.event.session.user.accessToken;
  if (access_token) {
    this.emit(':ask', 'What would you like to do?', "I'm sorry, I didn't hear you. Could you say that again?");
  } else {
    this.emit(':tellWithLinkAccountCard', "Please connect your Slack account to Alexa using the Alexa app.");
  }
}

/**
 * Handles an `SlackAwayIntent`, sent when the user requests their presence
 * to be set to away or active.
 */
function slackAwayIntentHandler() {
  let status = this.event.request.intent.slots.awaystatus.value;
  let access_token = this.event.session.user.accessToken;

  if (!access_token) {
    this.emit(':tellWithLinkAccountCard', 'Please connect your Slack account to Alexa using the Alexa app on your phone.');
  }

  if (!status) {
    this.emit(':elicitSlot', 'awaystatus', 'Would you like me to set you to away or active?', "I'm sorry, I didn't hear you. Could you say that again?");
  }

  setSlackPresence(status, access_token).
    then(() => { this.emit(':tell', `Okay, I'll set you to ${status}`); }).
    catch(error => { this.emit(':tell', error.message); });
}

/**
 * Handles an `SlackStatusIntent`, sent when the user requests their status changed.
 */
function slackStatusIntentHandler() {
  let status = this.event.request.intent.slots.status.value;
  let access_token = this.event.session.user.accessToken;

  if (!access_token) {
    this.emit(':tellWithLinkAccountCard', 'Please connect your Slack account to Alexa using the Alexa app on your phone.');
  }

  if (!status) {
    this.emit(':elicitSlot', 'status', `What would you like your status to be? Your options are: ${Object.keys(statuses).join(', ')}`, "I'm sorry, I didn't hear you. Could you say that again?");
  }

  if (statuses[status]) {
    setSlackStatus(statuses[status], access_token).
      then(() => { this.emit(':tell', `Okay, I'll set your status to ${status}.`); }).
      catch(error => { this.emit(':tell', error.message); });
  } else {
    this.emit(':elicitSlot', 'status', `I'm sorry, that's not a valid status. Your options are: ${Object.keys(statuses).join(', ')}`, "I'm sorry, I didn't hear you. Could you say that again?");
  }
}

/**
 * Handles an `SlackClearStatusIntent`, sent when the user requests their status
 * be cleared.
 */
function slackClearStatusIntentHandler() {
  let access_token = this.event.session.user.accessToken;
  let status = {
    status_text: '',
    status_emoji: ''
  };

  if (!access_token) {
    this.emit(':tellWithLinkAccountCard', 'Please connect your Slack account to Alexa using the Alexa app on your phone.');
  }

  setSlackStatus(status, access_token).
    then(() => { this.emit(':tell', "Okay, I'll clear your status."); }).
    catch(error => { this.emit(':tell', error.message); });
}

/**
 * Handles an `SlackSnoozeIntent`, sent when the user sets their DND setting.
 */
function slackSnoozeIntentHandler() {
  let device_id = this.event.context.System.device.deviceId;
  let consent_token = this.event.context.System.user.permissions.consentToken;
  let access_token = this.event.session.user.accessToken;
  let minutes;
  let duration;
  let requested_time;

  if (!access_token) {
    this.emit(':tellWithLinkAccountCard', 'Please connect your Slack account to Alexa using the Alexa app on your phone.');
  }

  if (!this.event.request.intent.slots.time.value) {
    if (this.event.request.intent.slots.duration.value) {
      duration = moment.duration(this.event.request.intent.slots.duration.value);
      if (duration.asHours() > 24) {
        this.emit(':ask', "I'm sorry, I can't snooze your notifications for more than a day. How long would you like to snooze your notifications for?", "I'm sorry, I didn't hear you. Could you say that again?");
      }
      minutes = duration.asMinutes();
    } else {
      minutes = 60;
    }
    setSlackDND(minutes, access_token).
      then(() => { this.emit(':tell', `Okay, I'll snooze your notifications for ${moment.duration(minutes, 'minutes').humanize()}.`); }).
      catch(error => { this.emit(':tell', error.message); });
  } else {
    getEchoUTCOffset(device_id, consent_token).
      then(offset => {
        requested_time = normalizeAmazonTime(this.event.request.intent.slots.time.value);
        minutes = getMinutesUntil(requested_time, offset);
        return setSlackDND(minutes, access_token);
      }).
      then(() => { this.emit(':tell', `Okay, I'll snooze your notifications until ${moment(requested_time, 'HH:mm').format('h:mm a')}.`); }).
      catch(error => { this.emit(':tell', error.message); });
  }
}

function stopIntentHandler() {
  this.emit(':tell', "Okay");
}

function cancelIntentHandler() {
  this.emit(':tell', "Okay");
}

function helpIntentHandler() {
  let text = "<p>Here are a few things you can do:</p>";
  text += "<p>To set yourself to away, say: set me to away.</p>";
  text += "<p>To set yourself to active, say: set me to active.</p>";
  text += "<p>To set your status, say: set my status.</p>";
  text += "<p>To clear your status, say: clear my status.</p>";
  text += "<p>To snooze your notifications, say: snooze, followed by a duration, like snooze for 5 minutes, or a time, like snooze until 5:00 pm.</p>";
  this.emit(":ask", text, "I'm sorry, I didn't hear you. Could you say that again?");
}

function unhandledIntentHandler() {
  this.emit(':ask', "I didn't get that. What would you like to do?", "I'm sorry, I didn't hear you. Could you say that again?");
}

/**
 * Sets the Slack user's DND.
 * @param {Number} minutes The number of minutes to snooze notifications.
 * @param {String} token Slack auth token.
 * @return {Promise} A promise that resolves if the request is successful;
 * or is rejected with an error if it fails.
 */
function setSlackDND(minutes, token) {

  let opts = {
    method: 'POST',
    url: `https://slack.com/api/dnd.setSnooze`,
    form: {
      num_minutes: minutes,
      token: token
    },
    json: true,
    simple: false,
    resolveWithFullResponse: true
  };
  return request(opts).then(response => {
    if (response.statusCode !== 200 || !response.body.ok) {
      return Promise.reject(new Error(`I couldn't snooze notifications. The error from Slack was: ${response.body.error}`));
    }
  });
}

/**
 * Sets the Slack user's presence.
 * @param {String} presence The presence, can be away or active.
 * @param {String} token Slack auth token.
 * @return {Promise} A promise that resolves if the request is successful;
 * or is rejected with an error if it fails.
 */
function setSlackPresence(presence, token) {
  if (presence === 'active') {
    presence = 'auto';
  }

  let opts = {
    method: 'POST',
    url: `https://slack.com/api/users.setPresence`,
    form: {
      presence: presence,
      token: token
    },
    json: true,
    simple: false,
    resolveWithFullResponse: true
  };
  return request(opts).then(response => {
    if (response.statusCode !== 200 || !response.body.ok) {
      return Promise.reject(new Error(`I couldn't set the presence. The error from Slack was: ${response.body.error}`));
    }
  });
}

/**
 * Sets the Slack user's status.
 * @param {Object} status The user's requested status.
 * @param {String} token Slack auth token.
 * @return {Promise} A promise that resolves if the request is successful;
 * or is rejected with an error if it fails.
 */
function setSlackStatus(status, token) {
  let opts = {
    method: 'POST',
    url: `https://slack.com/api/users.profile.set`,
    form: {
      profile: JSON.stringify(status),
      token: token
    },
    json: true,
    simple: false,
    resolveWithFullResponse: true
  };
  return request(opts).then(response => {
    if (response.statusCode !== 200 || !response.body.ok) {
      return Promise.reject(new Error(`I couldn't set the status. The error from Slack was: ${response.body.error}`));
    }
  });
}

/**
 * Alexa can accept utterances like: "night", "morning", "afternoon", "evening".
 * This function normalizes them to reasonable hours.
 * @param {String} amazon_time The time from the AMAZON.TIME slot.
 * @return {String} A time, in HH:mm format.
 */
function normalizeAmazonTime(time) {
  switch(time) {
    case 'MO':
      time = '09:00';
      break;
    case 'AF':
      time = '13:00';
      break;
    case 'EV':
      time = '19:00';
      break;
    case 'NI':
      time = '21:00';
      break;
  }
  return time;
}

/**
 * Calculate the difference in minutes between the time sent by the Alexa skill and the current time.
 * @param {String} requested_time A time received from the Alexa skill (e.g. "13:00")
 * @param {Number} offset The user's timezone offset, in minutes.
 * @return {Number} The difference in minutes between the current time and requested_time.
 */
function getMinutesUntil(requested_time, offset) {
  // Convert the requested time and the current time to the user's timezone.
  requested_time = moment(`${requested_time}Z`, 'HH:mmZ').utcOffset(offset, true);
  now = moment(Date.now()).utcOffset(offset);

  // Requested time could be in the past, e.g. saying "9:00 am" at 10:00 am.
  // In that case assume the user meant the next day, so add a day.
  if (now > requested_time) {
    requested_time.add(1, 'day');
  }

  return requested_time.diff(now, 'minutes');
}

/**
 * Gets the UTC offset of the Echo, based on its address.
 * @param {String} device_id The Echo's device ID.
 * @param {String} consent_token The user's consent token.
 * @return {Promise.<String>} A promise that resolves to the offset of the Echo.
 */
function getEchoUTCOffset(device_id, consent_token) {
  return getEchoAddress(device_id, consent_token).
          then(geocodeLocation).
          then(getUTCOffset);
}

/**
 * Requests the Echo's country and postal code from the Alexa API.
 * @param {String} device_id The Echo's device ID.
 * @param {String} consent_token The user's consent token.
 * @return {Promise.<String>} A promise that resolves to the address of the Echo,
 or is rejected if the user hasn't granted permission.
 */
function getEchoAddress(device_id, consent_token) {
  let opts = {
    url: `https://api.amazonalexa.com/v1/devices/${device_id}/settings/address/countryAndPostalCode`,
    headers: {
      'Authorization': `Bearer ${consent_token}`
    },
    json: true,
    simple: false,
    resolveWithFullResponse: true
  };
  return request(opts).then(response => {
    if (response.statusCode === 200) {
      return `${response.body.postalCode} ${response.body.countryCode}`;
    } else {
      return Promise.reject(new Error("I'm sorry, I couldn't get your location. Make sure you've given this skill permission to use your address in the Alexa app."));
    }
  });
}

/**
 * Geocodes a location or address using the Google Maps API.
 * @param {String} location An address or location (e.g. "20003 USA").
 * @return {Promise.<Object>} A promise that resolves to the first result from the API, or
 * is rejected if the address is not valid.
 */
function geocodeLocation(location) {
  let opts = {
    url: `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${process.env.MAPS_API_KEY}`,
    json: true,
    simple: false,
    resolveWithFullResponse: true
  };
  return request(opts).then(response => {
    if ((response.statusCode === 200) && (response.body.status === 'OK')) {
      return response.body.results[0];
    } else {
      return Promise.reject(new Error(`I'm sorry, I couldn't understand that address. The response from Google Maps was ${response.body.status}`));
    }
  });
}

/**
 * Gets the timezone for a given location
 * @param {Object} location A geocoded location returned from the Google Maps geocoding API.
 * @return {Promise.<Number>} A promise that resolves to the offset from UTC in minutes,
 * or is rejected if the request fails.
 */
function getUTCOffset(location) {
  let opts = {
    url: `https://maps.googleapis.com/maps/api/timezone/json?location=${location.geometry.location.lat},${location.geometry.location.lng}&timestamp=${Math.round(Date.now()/1000)}&key=${process.env.MAPS_API_KEY}`,
    json: true,
    simple: false,
    resolveWithFullResponse: true
  };
  return request(opts).then(response => {
    if ((response.statusCode === 200) && (response.body.status === 'OK'))  {
      return (response.body.rawOffset + response.body.dstOffset)/60;
    } else {
      return Promise.reject(new Error(`I'm sorry, I couldn't get the timezone for that location. The response from Google Maps was ${response.body.status}`));
    }
  });
}
