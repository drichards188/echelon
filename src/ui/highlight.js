// The tutorials' highlight: elements carry data-tut="name other-name" and the tutorial pulses the ones
// whose names it asks for. The console is rebuilt when another unit is selected, so the Panel re-applies
// the current names after mounting.
let names = [];

export function applyHighlight() {
  for (const e of document.querySelectorAll('.tut-hi')) e.classList.remove('tut-hi');
  for (const n of names) for (const e of document.querySelectorAll(`[data-tut~="${n}"]`)) e.classList.add('tut-hi');
}

export function setHighlight(list) {
  names = list ? [...list] : [];
  applyHighlight();
}

// tag one or several elements: tut(btn.el, 'launch')
export function tut(el, name) {
  el.dataset.tut = el.dataset.tut ? `${el.dataset.tut} ${name}` : name;
  return el;
}
