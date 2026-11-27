// Playing together: hosting a group and joining one. The host's side is the
// "Play together" section of the setup screen, and a guest has a screen of
// its own. See section 9 of docs/design.md and step 3 of
// docs/multi-device-plan.md.
//
// Messages from the host: welcome (the guest's number), players (everyone's
// numbers) and end. From a guest: leave.

import { Peer } from './peer.js';
import { drawCode, scanCode } from './qr.js';
import { addPlayer, createRoster, playerName, removePlayer } from './roster.js';
import { findPackedText } from './signal.js';

// How long the host waits, after reading a player's code, for the
// connection to open.
const OPEN_TIMEOUT = 20000;

const CONNECT_HELP = 'Both devices need to be on the same Wi-Fi. Some guest and public Wi-Fi keeps '
  + 'devices apart, and a phone’s hotspot usually works instead. On a Mac, the browser also needs '
  + 'permission in System Settings › Privacy & Security › Local Network.';

const $ = (id) => document.getElementById(id);

export class Group {
  // `show` switches to a screen by name: "setup" or "guest".
  constructor({ show }) {
    this.show = show;
    this.role = null;
    this.wakeLock = null;
    this.reset();

    $('host-button').addEventListener('click', () => this.host());
    $('join-button').addEventListener('click', () => {
      $('join-paste').hidden = false;
      $('join-input').focus();
    });
    $('join-input-button').addEventListener('click', () => {
      const data = findPackedText($('join-input').value);
      if (data) {
        this.join(data);
      } else {
        this.message('That is not a link from a host.');
      }
    });
    $('add-player-button').addEventListener('click', () => this.invite());
    $('end-group-button').addEventListener('click', () => this.end());
    $('invite-copy').addEventListener('click', () => copyText($('invite-text')));
    $('invite-cancel').addEventListener('click', () => this.cancelInvite());
    $('scan-button').addEventListener('click', () => this.scan());
    $('scan-stop').addEventListener('click', () => this.stopScan());
    $('reply-button').addEventListener('click', () => this.acceptReply($('reply-input').value));
    $('reply-copy').addEventListener('click', () => copyText($('reply-text')));
    $('leave-button').addEventListener('click', () => this.leave());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.role) {
        this.keepAwake();
      }
    });
    // The camera needs a secure context, which a phone reaching a
    // development server on the local network does not have.
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      $('scan-button').hidden = true;
    }
  }

  reset() {
    this.roster = null;
    // Host: the joined players' connections by number, and those still
    // connecting.
    this.guests = new Map();
    this.connecting = new Set();
    this.pending = null;
    this.scanner = null;
    // Guest: the connection to the host, this player's number and everyone's.
    this.peer = null;
    this.number = null;
    this.players = [];
  }

  // Joins from a host's link (#join=…), if the page was opened from one.
  // The fragment is cleared, so that reloading does not join again.
  // Returns whether it is joining.
  openJoinLink() {
    if (!location.hash.startsWith('#join=')) {
      return false;
    }
    const data = findPackedText(location.hash);
    history.replaceState(null, '', location.pathname + location.search);
    if (!data) {
      this.message('That link has no code in it. Ask the host for a fresh one.');
      return false;
    }
    this.join(data);
    return true;
  }

  // The host's code is shown only between songs.
  songStarting() {
    this.cancelInvite();
  }

  message(text) {
    $(this.role === 'guest' ? 'guest-message' : 'together-message').textContent = text;
  }

  async keepAwake() {
    try {
      this.wakeLock = await navigator.wakeLock?.request('screen');
    } catch {
      // Not allowed now. Tried again when the page is shown.
    }
  }

  releaseWake() {
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
  }

  // ---- Host

  host() {
    this.role = 'host';
    this.roster = createRoster();
    this.message('');
    $('together-start').hidden = true;
    $('group').hidden = false;
    this.keepAwake();
    this.render();
  }

  async invite() {
    this.message('');
    $('group-buttons').hidden = true;
    let peer;
    try {
      peer = await Peer.host();
    } catch (error) {
      $('group-buttons').hidden = false;
      this.message(`Could not make a code. ${error.message}`);
      return;
    }
    if (this.role !== 'host') {
      peer.close();
      return;
    }
    this.pending = peer;
    const link = `${location.origin}${location.pathname}#join=${peer.packed}`;
    $('invite').hidden = false;
    $('invite-text').value = link;
    $('invite-text').hidden = true;
    $('reply-input').value = '';
    drawCode($('invite-code'), link);
    offerShare($('invite-share'), { url: link });
  }

  cancelInvite() {
    this.stopScan();
    this.pending?.close();
    this.pending = null;
    $('invite').hidden = true;
    $('group-buttons').hidden = this.role !== 'host';
  }

  async scan() {
    $('scan-video').hidden = false;
    $('scan-stop').hidden = false;
    $('scan-button').disabled = true;
    this.scanner = scanCode($('scan-video'));
    try {
      const text = await this.scanner.result;
      if (text) {
        this.stopScan();
        await this.acceptReply(text);
      }
    } catch (error) {
      this.message(`Could not use the camera. ${error.message}`);
    } finally {
      this.stopScan();
    }
  }

  stopScan() {
    this.scanner?.stop();
    this.scanner = null;
    $('scan-video').hidden = true;
    $('scan-stop').hidden = true;
    $('scan-button').disabled = false;
  }

  async acceptReply(text) {
    const data = findPackedText(text);
    const peer = this.pending;
    if (!peer) {
      return;
    }
    if (!data) {
      this.message('That is not a code from a player’s device.');
      return;
    }
    try {
      await peer.acceptAnswer(data);
    } catch {
      this.message('That code did not work. Check it is the one the new player’s device shows.');
      return;
    }
    this.pending = null;
    $('invite').hidden = true;
    $('group-buttons').hidden = false;
    this.message('');
    this.connecting.add(peer);
    this.render();

    let number = null;
    const timer = setTimeout(() => {
      if (number === null) {
        this.connecting.delete(peer);
        peer.close();
        this.message(`Could not connect to the new player. ${CONNECT_HELP}`);
        this.render();
      }
    }, OPEN_TIMEOUT);
    peer.onstatechange = (state) => {
      if (this.role !== 'host') {
        return;
      }
      if (state === 'open' && number === null) {
        clearTimeout(timer);
        this.connecting.delete(peer);
        ({ roster: this.roster, number } = addPlayer(this.roster));
        this.guests.set(number, peer);
        peer.send({ type: 'welcome', number });
        this.sendPlayers();
        this.render();
      } else if (state !== 'open' && number !== null) {
        this.removeGuest(number);
      } else if (state === 'failed' && number === null) {
        clearTimeout(timer);
        this.connecting.delete(peer);
        peer.close();
        this.message(`Could not connect to the new player. ${CONNECT_HELP}`);
        this.render();
      }
    };
    peer.onmessage = (message) => {
      if (message.type === 'leave' && number !== null) {
        this.removeGuest(number);
      }
    };
  }

  removeGuest(number) {
    const peer = this.guests.get(number);
    if (!peer) {
      return;
    }
    this.guests.delete(number);
    peer.onstatechange = null;
    peer.close();
    this.roster = removePlayer(this.roster, number);
    this.sendPlayers();
    this.render();
  }

  sendPlayers() {
    for (const peer of this.guests.values()) {
      peer.send({ type: 'players', players: this.roster.players });
    }
  }

  end() {
    this.cancelInvite();
    for (const peer of [...this.guests.values(), ...this.connecting]) {
      peer.onstatechange = null;
      peer.send({ type: 'end' });
      // Closing at once can drop the message before it is sent.
      setTimeout(() => peer.close(), 200);
    }
    this.role = null;
    this.reset();
    this.releaseWake();
    this.message('');
    $('group').hidden = true;
    $('together-start').hidden = false;
  }

  render() {
    const items = this.roster.players.map((number) => {
      const item = document.createElement('li');
      item.textContent = playerName(number);
      if (number === 1) {
        item.append(' ', Object.assign(document.createElement('span'), { className: 'note', textContent: '(you, the host)' }));
      }
      return item;
    });
    for (let i = 0; i < this.connecting.size; i++) {
      items.push(Object.assign(document.createElement('li'), { className: 'note', textContent: 'Connecting…' }));
    }
    $('player-list').replaceChildren(...items);
  }

  // ---- Guest

  async join(data) {
    this.role = 'guest';
    this.show('guest');
    $('guest-reply').hidden = true;
    $('guest-message').textContent = '';
    $('leave-button').textContent = 'Leave';
    this.status('Getting ready…');
    this.keepAwake();
    let peer;
    try {
      peer = await Peer.join(data);
    } catch {
      this.lost('That link did not work. Ask the host to add a player again, for a fresh code.');
      return;
    }
    if (this.role !== 'guest') {
      peer.close();
      return;
    }
    this.peer = peer;
    $('guest-reply').hidden = false;
    $('reply-text').value = peer.packed;
    $('reply-text').hidden = true;
    drawCode($('reply-code'), peer.packed);
    offerShare($('reply-share'), { text: peer.packed });
    this.status('Waiting for the host to scan this code.');

    let opened = false;
    let timer = null;
    peer.onstatechange = (state) => {
      if (this.peer !== peer) {
        return;
      }
      if (state === 'open') {
        opened = true;
        clearTimeout(timer);
        $('guest-reply').hidden = true;
        $('guest-message').textContent = '';
        this.status('Joined. Waiting for the host.');
      } else if (opened) {
        this.lost('Lost the connection to the host. To join again, scan the host’s code again.');
      } else if (state === 'connecting' && timer === null) {
        timer = setTimeout(() => this.message(`Could not connect to the host yet. ${CONNECT_HELP}`), OPEN_TIMEOUT);
      } else if (state === 'failed') {
        clearTimeout(timer);
        this.lost(`Could not connect to the host. ${CONNECT_HELP}`);
      }
    };
    peer.onmessage = (message) => {
      if (message.type === 'welcome') {
        this.number = message.number;
        this.showJoined();
      } else if (message.type === 'players') {
        this.players = message.players;
        this.showJoined();
      } else if (message.type === 'end') {
        this.lost('The host ended the group.');
      }
    };
  }

  showJoined() {
    if (this.number === null) {
      return;
    }
    const others = this.players.length > 1 ? ` ${this.players.length} players are in the group.` : '';
    this.status(`You are ${playerName(this.number)}.${others} Waiting for the host.`);
  }

  status(text) {
    $('guest-status').textContent = text;
  }

  // The connection has ended. The guest stays on its screen to read why,
  // and goes back with the button.
  lost(text) {
    const peer = this.peer;
    this.peer = null;
    if (peer) {
      peer.onstatechange = null;
      peer.close();
    }
    $('guest-reply').hidden = true;
    this.status('');
    this.message(text);
    $('leave-button').textContent = 'Back';
    this.releaseWake();
  }

  leave() {
    if (this.peer) {
      this.peer.send({ type: 'leave' });
      const peer = this.peer;
      this.peer = null;
      peer.onstatechange = null;
      // Closing at once can drop the message before it is sent.
      setTimeout(() => peer.close(), 200);
    }
    this.role = null;
    this.reset();
    this.releaseWake();
    $('guest-message').textContent = '';
    this.show('setup');
  }
}

async function copyText(textarea) {
  try {
    await navigator.clipboard.writeText(textarea.value);
  } catch {
    // Without the clipboard, as on plain HTTP, the text is shown to copy by
    // hand.
    textarea.hidden = false;
    textarea.select();
  }
}

function offerShare(button, data) {
  if (!navigator.share) {
    return;
  }
  button.hidden = false;
  button.onclick = () => navigator.share(data).catch(() => {});
}
