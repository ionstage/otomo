# Multiple devices plan

This was the handoff for implementing multiple devices, the first item in
section 9 of [design.md](design.md). All six steps are done and were
checked by the user on an iPad, an iPhone and a Mac, so this document now
records how it was built. The design document records what was agreed,
including the decisions made along the way.

The first build is complete and is recorded in
[first-build-plan.md](first-build-plan.md). Everything in it still applies
to playing on one device, and playing alone must keep working exactly as it
does now.

## Agreed

These are in section 9 of the design. In short:

- WebRTC data channels on the local network, with no server of any kind.
  Each guest connects to the host only.
- Connection details pass by QR code. The guest scans the host's code with
  the phone's own camera app, which opens the game at
  `…/otomo/#join=<data>`. The guest then shows a reply code, which the host
  scans in the game. The host shows a fresh code for each guest.
- Only the fields that differ between connections go in the codes, and the
  rest of the session description is rebuilt on the other side.
- The same data can be shown as a link to copy.
- Every device plays the untaken parts, with autoplay turned down as devices
  join (for example divided by √N), reviewed after the trial.
- jsQR (Apache-2.0) reads QR codes and Nayuki's QR Code generator (MIT) draws
  them. Nothing else is added.
- The work starts with a trial, before any game screens depend on it.

## Suggested file layout

This is a suggestion. Change it if a better split appears.

```
js/signal.js    pack a session description into the few fields a code
                carries, and rebuild it from them (pure)
js/clock.js     estimate the offset between two devices' clocks from
                ping samples (pure)
js/peer.js      RTCPeerConnection and data channel, messages to and from
                the host
js/qr.js        draw a code with qrcodegen, scan one from the camera with
                jsQR
js/vendor/jsQR.js
js/vendor/jsQR-LICENSE
js/vendor/qrcodegen.js
js/vendor/qrcodegen-LICENSE
test/signal.test.js
test/clock.test.js
```

`signal.js` and `clock.js` must be pure, like `judge.js`, so they can be
tested with `node --test`. So should anything else that can be: the autoplay
volume for a number of devices, the group score, and who holds which part.

The vendor files go under `js/` so that the Pages workflow already publishes
them, with their licences beside them.

- **jsQR:** use the released `dist/jsQR.js` (version 1.4.0). It is a UMD
  bundle, not an ES module, so check how it loads. A classic `<script>` that
  sets `window.jsQR`, loaded only when scanning starts, is the simple way.
- **qrcodegen:** Nayuki's JavaScript version is published as TypeScript
  (`qrcodegen.ts`). Convert it to plain JavaScript once, keep the licence
  header, and check that file in. That is a one-time copy, not a build step.
  Record the version it came from in the file.

## Suggested order

Each step ends with something that can be checked.

1. **Packing the session description.** `signal.js` packs a data-channel-only
   offer or answer into the ICE user fragment and password, the DTLS
   fingerprint, the setup role and the candidates, and encodes them as
   base64url for a link's fragment. It rebuilds a full description from
   them. Check: tests round-trip real offers and answers captured from
   Chrome, Safari and Firefox, and the packed data is about 150 bytes or less.
2. **The trial.** A separate page, not part of the game, that:
   - lets one device host and another join, by QR code both ways and by the
     copied link;
   - shows the connection state and the candidates used (mDNS name or IP
     address);
   - pings the host repeatedly and shows the estimated clock offset, the
     round-trip times and how the offset changes over a few minutes;
   - plays a click on every device at the same moment, every second;
   - plays a song with every part on autoplay on every device, to hear
     whether the doubled sound phases.

   Check, by the user: connect two phones on home Wi-Fi and on a phone
   hotspot, an iPhone with an Android phone, and a laptop host with a phone
   guest. Listen to whether the clicks sound as one, and whether the song
   sounds right from two devices. Then decide whether to go on as agreed, or
   change the approach (see "After the trial").

   Steps 1 and 2 are done. The outcome is under "After the trial".
3. **Joining.** The setup screen gains a way to host and to join. The host
   sees who has joined, and shows its code only between songs. A guest who
   opens a `#join=` link goes straight to showing the reply code. When a
   connection does not open, both devices say so, and mention the Local
   Network permission on a Mac.

   Done, and checked by the user on an iPad, an iPhone and a Mac: joining by
   camera, a third device, leaving, ending the group, the layout on a phone
   and playing alone. Until step 4, a guest waits, and the host can still
   play alone.
4. **Choosing and starting.** The lobby, as in section 9 of the design: the
   turn to choose the song, choosing a part and a difficulty as the ready
   tap, and the start when everyone is ready. Check: three devices take
   turns through a few songs, and the song starts when the last player
   chooses, or when a player who has not chosen disconnects.

   Done. Checked in headless Chrome with three devices (turns, ready,
   changing a choice, leaving, and the start, within 2 ms on all three),
   and by the user on an iPad, an iPhone and a Mac.
   A bug found in step 5: at the start, every device autoplayed every part,
   the players' own included. Fixed.
5. **Playing together.** Every device counts in and plays together, plays
   the untaken parts at the lowered volume, and plays its own player's part.
   The guests keep pinging during the song and correct their timing from
   the latest offset, since the trial measured drift of up to 170 ppm.

   Built, and checked in headless Chrome with three devices: autoplay at
   1/√3 of its level, retiming once a second on the guests, a guest leaving
   the song with the music playing on, and the host ending it for everyone.

   Then, by the user's decision, each player's notes also play on the other
   devices, as they are played, at the autoplay level. Checked in headless
   Chrome: a guest's presses, replacements and releases play on the host
   and the other guest, and not twice on its own device.

   A bug found by the user: a guest who quit a song and waited in the lobby
   could start the next song seconds late, stuck before its count-in. iOS
   had most likely suspended its audio, which stops its clock, and the
   guest kept its old offset. A guest now sets its clock again when its
   audio stops running or its pings jump, and the host waits for it.
   Confirmed fixed by the user.

   Done, and checked by the user on an iPad, an iPhone and a Mac: the
   balance of autoplay, Rondo alla Turca staying together from a Mac host
   to an iPhone, a guest's and the host's Quit, pausing alone, other
   players' notes, and held parts. A song from the lobby counts as played
   together even when the host has no guests left, so it does not pause.
   Quit as the design describes, with no pause. Check: two people play a
   song together on two phones.
6. **Scores and lost connections.** Each device sends its song score to the
   host, which sends the group score back to everyone. A device that loses
   its connection plays on and shows only its own score. Check: the group
   score is the average of the players' song scores, and turning a guest's
   Wi-Fi off mid-song leaves the others' result correct.

   Done. Checked in headless Chrome with three devices over three songs:
   everyone finishing, a guest quitting, and a guest's page closing
   mid-song, which the host noticed after 5 seconds of silence. Closing
   the host's page left the guests showing only their own scores. Then
   checked by the user on the devices, with a guest's Wi-Fi turned off
   mid-song.

## Technical notes

- **Secure context.** The camera needs HTTPS, or `localhost`. Phones on the
  local network reach `python3 -m http.server` over plain HTTP, so they can
  open the game but not use the camera. Test scanning on GitHub Pages. For
  the trial, the simplest way is to add the trial page to the files the Pages
  workflow copies while the trial runs, and remove it afterwards.
  `RTCPeerConnection` does not need a secure context, so the copied link can
  be tested over plain HTTP.
- **No trickle ICE.** There is no channel to send candidates later. Wait for
  ICE gathering to complete before packing a description, with a timeout.
  Configure no STUN or TURN servers.
- **mDNS candidates.** Browsers hide local IP addresses behind generated
  `.local` names, and the other device has to resolve them by multicast DNS.
  This fails on some networks and some Android phones. A page with camera
  permission is generally given real addresses instead. Pack whichever the
  browser gives, and let the trial show which were used.
- **The link's fragment** (`#join=…`) is never sent to the web server, so the
  connection details do not reach GitHub. Clear it from the address bar once
  read, so that reloading does not try to join again.
- **Camera on iOS.** The `<video>` element needs `playsinline` and `muted`.
  Stop the camera as soon as a code is read.
- **Clock sync.** Each device's Web Audio clock stays its single time
  reference, as in section 7 of the design. A guest sends a ping with its
  audio time `t0`, the host replies with its own audio time `th`, and the
  guest notes when the reply arrived (`t1`). The offset is `th - (t0 + t1) / 2`.
  Take many samples and use those with the shortest round trip. Two audio
  clocks drift apart slowly, by perhaps a few milliseconds over a song, so
  keep pinging during the song. The trial shows whether the drift needs
  correcting.
- **Output latency.** For sound to leave the speakers together, each device
  can schedule earlier by its own `outputLatency`, where the browser reports
  it. The trial shows whether that helps. `audio.js` already uses it for
  input times.
- **Start signal.** The host sends the start time on its own clock, far
  enough ahead (around a second) to reach every guest. Each device converts
  it to its own clock and starts its count-in then.
- **Messages.** JSON over one ordered, reliable data channel. Suggested
  messages: a guest's choice of part and difficulty, ping and pong, start,
  score, and the group score.
- **Screens sleeping.** A phone may sleep while waiting in the lobby. Use the
  Screen Wake Lock API where the browser has it.

## Not yet decided

How the group plays together was decided with the user and is in section 9
of the design. These smaller points remain, each with a suggested default.
Use the default and report it, unless it turns out to need more than that.

| Topic | Suggested default |
|---|---|
| Showing who is ready | Every device lists the players and which of them are ready. |
| The result screen with several devices | One button, Continue, back to the lobby for the next player's turn, and a way to leave the group. Play again and Change song stay as they are for one device. |
| The chooser leaves before choosing | The turn passes to the next player. |
| Changing a choice after being ready | Allowed until the song starts. The player stays ready. |
| Latency calibration (open question 2 of the design) | Not for now. The reported output latency is allowed for, which the trial showed covers Bluetooth. |
| Number of players | No fixed limit. Each part has one player, and with more players than parts the rest sit the song out (section 9 of the design). |

## After the trial

The trial decided whether the agreed approach stands:

- If phones fail to connect on ordinary home Wi-Fi, look at why (mDNS,
  network isolation) before going further. Ask the user before considering a
  server of any kind, since the design chose to have none.
- If the doubled autoplay sound phases badly, switch to each untaken part
  being played by one device only, as the design allows, and decide what
  happens when that device drops out.
- If the clocks drift noticeably over a song, correct them during the song.

The outcome, recorded in section 9 of the design: the approach stands.

- An iPad with an iPhone, and a Mac running Chrome with an iPhone, connected
  on home Wi-Fi with mDNS names, by QR code and by copied text. Chrome on
  the Mac first needed the Local Network permission. Android phones and
  hotspots were not available, and are looked at if problems arise.
- Clicks and songs sounded as one, and the doubled autoplay did not phase.
- Round trips were 4 to 12 ms. The clocks drifted by 13 ppm (iPad and
  iPhone) and 170 ppm (Mac and iPhone), so drift is corrected during the
  song, in step 5.
- Timing sound by when it is heard brought a Bluetooth speaker, 190 to
  200 ms late, back into line. Safari's output timestamp leaves the output
  latency out, so `AudioEngine.audibleTime` takes off what it misses. That
  fix also corrected the scoring when playing alone on Bluetooth.
- The trial page stays in `trial/`, no longer published. Serve the
  repository and open `/trial/` to use it again.
