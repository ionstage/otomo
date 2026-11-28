// How loud autoplay is with several devices. Every device plays the parts
// nobody has taken, so the room hears each of them from every device. Each
// device turns them down by the square root of the number of devices, so
// that a player's own part, which only their device plays, stays a little
// louder than autoplay. See section 9 of docs/design.md.

// The share of the solo autoplay level for `devices` devices playing.
export function autoplayShare(devices) {
  return 1 / Math.sqrt(Math.max(1, devices));
}
