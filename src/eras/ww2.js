// The late-war WW2 era: German flak, 1944 to 1945. A placeholder until its content exists: it shows on
// the main menu, disabled and marked as in development. To make it playable, fill in the fields below as
// eras/modern.js does (DESIGN.md, "Eras") and set `available: true`.

export default {
  id: 'ww2',
  name: 'WW2',
  years: '1944 to 1945',
  available: false,
  theme: 'ww2',
  markings: null,

  text: {
    sub: 'Flak',
    blurb: '',
    setting: 'German flak against the bomber offensive, 1944 to 1945. In development.',
    orders: '',
    lull: '',
    victory: '',
    defeat: '',
  },

  layout: { threatAxis: 0, assets: [], vital: [], sites: [] },
  slots: [],
  waves: [],
  alerts: {},
  tutorials: [],

  // its models, consoles and reload scenes, fetched only when the era is picked (eras/index.js loadEra)
  content: () => import('./ww2/content.js'),
};
