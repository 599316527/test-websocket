var fs = require('fs');
var URL = require('url');
var express = require('express');
var path = require('path');
var ws = require("nodejs-websocket");
var cookieParser = require('cookie-parser')
var EventEmitter = require('events');

var sessions = {}

var app = express();

app.use(cookieParser())

app.get('/client', function (req, res, next) {
  var cid = req.cookies.cid || randomSid()
  res.cookie('cid', cid, {
    maxAge: 100 * 24 * 3600 * 1e3,
    httpOnly: false,
    secure: false
  })
  res.type('.html').sendFile(path.resolve(__dirname, './client.html'))
});

app.get('/devices', function (req, res, next) {
  var sid = req.cookies.sid
  var devices = []
  if (sid) {
    var session = sessions[sid]
    if (session) {
      devices = Object.keys(session.devices)
    }
  }
  res.send({
    code: 0,
    data: {
      devices: devices
    }
  }).end()
});

app.get('/', function (req, res, next) {
  var sid = req.cookies.sid || randomSid()
  res.cookie('sid', sid, {
    maxAge: 100 * 24 * 3600 * 1e3,
    httpOnly: false,
    secure: false
  })
  res.type('.html').sendFile(path.resolve(__dirname, './control.html'))
});

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  var err = new Error();
  err.status = 404;
  next(err);
});

// error handler
app.use(function (err, req, res, next) {
  console.log(err)
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = err;
  // render the error page
  res.sendStatus(err.status || 500);
});


var port = process.env.PORT || 3000
app.listen(port);
console.log('Server is listening on ' + port)

module.exports = app;

var wsServer = ws.createServer(function (conn) {
    // {
    //    role: control|client
    //    sid: xxxx
    //    cid: xxxx
    //    ts: 1234567890
    //    data: {...}
    // }
    conn.on('text', function (str) {
      var data = {}
      try {
        data = JSON.parse(str)
      }
      catch (err) {
        conn.sendText(JSON.stringify({
          code: 1,
          msg: err.message
        }))
        return
      }
      if (data.role === 'control') {
        var sid = data.sid
        if (!sessions[sid]) {
          sessions[sid] = {
            devices: []
          }
        }
        var session = sessions[sid]
        session.lastConnTime = Date.now()
        var devices = session.devices
        // console.log('from control %s to devices %s', sid,
        //   Object.keys(devices).join(', '))
        Object.keys(devices).forEach(function (key) {
          var device = devices[key]
          try {
            device.emitter.emit('update', data)
          }
          catch (err) {
            console.log('Error in emitting update for ' + key, err)
            delete devices[key]
          }
          device.lastConnTime = Date.now()
        })
      }
      else if (data.role === 'client') {
        var sid = data.sid
        var cid = data.cid
        if (!sessions[sid]) {
          conn.sendText(JSON.stringify({
            code: 2,
            msg: 'No session for ' + sid
          }))
          return
        }

        var emitter = new EventEmitter()
        emitter.on('update', function (data) {
          // console.log('will update', data)
          conn.sendText(JSON.stringify({
            code: 0,
            data: Object.assign({
              ts: data.ts,
              ts2: Date.now(),
              action: 'update'
            }, data.data)
          }))
        })
        sessions[sid].devices[cid] = {
          emitter: emitter,
          lastConnTime: Date.now()
        }
        console.log('new device: sid=%s, cid=%s', sid, cid)
        printDevices()
      }
    })

    conn.on('close', function (code, reason) {
      console.log('ws conn close', code, reason)
    })

    conn.on('error', function (err) {
      if (err.code !== 'ECONNRESET') {
          // Ignore ECONNRESET and re throw anything else
          throw err
      }
    })
}).listen(18081);

function printDevices() {
  Object.keys(sessions).forEach(function (key) {
    console.log('SESSION ' + key)
    Object.keys(sessions[key].devices).forEach(function (key) {
      console.log('+- DEVICE ' + key)
    })
  })
}

setInterval(function () {
  // print
  console.log('CLEAN ', new Date())
  printDevices()

  // clean
  sessions = Object.keys(sessions).reduce(function (ns, key) {
    var session = sessions[key]
    var expire = Date.now() - 2 * 60 * 60 * 1e3
    if (session.lastConnTime < expire) {
      return ns
    }
    var devices = session.devices
    session.devices = Object.keys(devices).reduce(function (nd, key) {
      if (devices[key].lastConnTime < expire) {
        return nd
      }
      nd[key] = devices[key]
      return nd
    }, {})
    ns[key] = session
    return ns
  }, {})
}, 5 * 60 * 1e3)


function randomSid() {
  return (0xFFFF + Math.floor(Math.random() * 0xFFFFF)).toString(36).toUpperCase()
}

