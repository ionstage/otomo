// One connection between the host and a guest: an RTCPeerConnection with a
// single ordered, reliable data channel carrying JSON messages. The session
// descriptions are exchanged in the packed form from signal.js, so there is
// no trickle ICE: each side waits for gathering to finish before packing.

import { packDescription, unpackDescription } from './signal.js';

// No STUN or TURN servers: the devices are on the same network.
const CONFIGURATION = { iceServers: [] };
const GATHER_TIMEOUT = 3000;

function gathered(connection) {
  if (connection.iceGatheringState === 'complete') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(done, GATHER_TIMEOUT);
    function done() {
      clearTimeout(timer);
      connection.removeEventListener('icegatheringstatechange', check);
      resolve();
    }
    function check() {
      if (connection.iceGatheringState === 'complete') {
        done();
      }
    }
    connection.addEventListener('icegatheringstatechange', check);
  });
}

export class Peer {
  constructor() {
    this.connection = new RTCPeerConnection(CONFIGURATION);
    this.channel = null;
    this.onmessage = null;
    this.onstatechange = null;
    this.connection.addEventListener('connectionstatechange', () => this.changed());
  }

  // The host's side. Returns the packed offer.
  static async host() {
    const peer = new Peer();
    peer.useChannel(peer.connection.createDataChannel('otomo', { ordered: true }));
    await peer.connection.setLocalDescription();
    await gathered(peer.connection);
    peer.packed = packDescription(peer.connection.localDescription);
    return peer;
  }

  // The guest's side, from the host's packed offer. Returns the packed
  // answer.
  static async join(offerText) {
    const peer = new Peer();
    peer.connection.addEventListener('datachannel', (event) => peer.useChannel(event.channel));
    await peer.connection.setRemoteDescription(unpackDescription(offerText));
    await peer.connection.setLocalDescription();
    await gathered(peer.connection);
    peer.packed = packDescription(peer.connection.localDescription);
    return peer;
  }

  // The host's side, from the guest's packed answer.
  acceptAnswer(answerText) {
    return this.connection.setRemoteDescription(unpackDescription(answerText));
  }

  useChannel(channel) {
    this.channel = channel;
    channel.addEventListener('open', () => this.changed());
    channel.addEventListener('close', () => this.changed());
    channel.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      this.onmessage?.(message);
    });
  }

  // "new", "connecting", "connected", "disconnected", "failed" or "closed",
  // and "open" once the data channel can carry messages.
  get state() {
    if (this.channel?.readyState === 'open') {
      return 'open';
    }
    return this.connection.connectionState;
  }

  changed() {
    this.onstatechange?.(this.state);
  }

  send(message) {
    if (this.channel?.readyState === 'open') {
      this.channel.send(JSON.stringify(message));
    }
  }

  close() {
    this.channel?.close();
    this.connection.close();
  }

  // The local and remote candidates in use, or null before a pair is chosen.
  async selectedCandidates() {
    const stats = await this.connection.getStats();
    let pair = null;
    stats.forEach((report) => {
      if (report.type === 'transport' && report.selectedCandidatePairId) {
        pair = stats.get(report.selectedCandidatePairId);
      }
    });
    if (!pair) {
      // Firefox marks the pair instead of naming it on the transport.
      stats.forEach((report) => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded' && (report.selected || report.nominated)) {
          pair ??= report;
        }
      });
    }
    if (!pair) {
      return null;
    }
    const describe = (candidate) => candidate && {
      address: candidate.address ?? candidate.ip,
      port: candidate.port,
      type: candidate.candidateType,
      protocol: candidate.protocol,
    };
    return {
      local: describe(stats.get(pair.localCandidateId)),
      remote: describe(stats.get(pair.remoteCandidateId)),
      rtt: pair.currentRoundTripTime ?? null,
    };
  }
}
