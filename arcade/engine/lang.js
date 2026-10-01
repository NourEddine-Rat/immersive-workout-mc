// The game speaks English.
//
// It used to say everything twice — every card, every cue and every shout
// carried its Arabic twin. That is off. The Arabic itself is still here,
// in the strings where it was written and in the markup where it was laid
// out, behind the one switch below: turn AR on and the second line comes
// back everywhere at once — the cards, the profiling cues, the perk banner,
// the dog's shout and the phone's own page.
//
// Two shapes, because the Arabic came in two shapes:
//   ar(s)        a card's second line, built in a template string
//   class="ar-only"  a node in the markup that holds nothing else

export const AR = false;

/** A card's second line, when the game is saying things twice. */
export const ar = s => (AR ? `<div class="ar">${s}</div>` : '');

/** Show or hide every node that carries Arabic and nothing else. Call once, after the page is parsed. */
export function langInit(root = document) {
  const nodes = root.querySelectorAll ? root.querySelectorAll('.ar-only') : [];
  for (let i = 0; i < nodes.length; i++) nodes[i].hidden = !AR;
}
