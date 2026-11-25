/**
 * First-launch data. A new user gets createStarterData(): one topic with a
 * single welcome note. The full sample wall (createSeedData) is only loaded
 * on request, from Settings → Samples. Everything here is ordinary data:
 * it is saved, edited, and deleted exactly like anything the user creates.
 */

let seq = 0;
const id = (p) => `${p}_seed${(seq++).toString(36)}`;

// Small deterministic pseudo-random so the sample wall looks hand-placed but stable.
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/**
 * Lay notes out in loose columns, like someone sticking them on a wall.
 * Each spec: [title, body, color, options?]
 */
function wall(topicId, specs, seed = 7) {
  const r = rng(seed);
  const cols = 4;
  const colX = [48, 330, 612, 894];
  const colY = [44, 70, 36, 62];
  return specs.map((spec, i) => {
    const [title, body, color, opt = {}] = spec;
    const c = opt.col ?? i % cols;
    const w = opt.w ?? 210 + Math.round(r() * 40);
    const x = colX[c] + Math.round(r() * 26 - 8);
    const y = colY[c];
    const chars = Math.floor((w - 32) / 7.1);
    const lines = body.split('\n').reduce((sum, l) => sum + Math.max(1, Math.ceil(l.length / chars)), 0);
    const estH = opt.h ?? Math.max(132, 50 + lines * 21 + (title ? 26 : 0));
    colY[c] += estH + 34 + Math.round(r() * 26);
    return {
      id: opt.id ?? id('n'),
      topicId,
      title,
      body,
      color,
      x,
      y,
      w,
      h: opt.h ?? null,
      rotation: opt.rotation ?? Math.round((r() * 4 - 2) * 10) / 10,
      z: i + 1,
      archived: !!opt.archived,
      stickers: (opt.stickers || []).map(([emoji, at], k) => {
        const spot = { tr: [w - 10, 8], br: [w - 10, estH - 12], bl: [16, estH - 10], r: [w + 2, estH * 0.5] }[at];
        return { id: `s_seed${i}_${k}`, emoji, x: Math.round(spot[0]), y: Math.round(spot[1]), rot: Math.round(r() * 30 - 15) };
      }),
      createdAt: Date.now() - (specs.length - i) * 3600_000,
      updatedAt: Date.now() - (specs.length - i) * 1800_000,
    };
  });
}

export function createSeedData() {
  seq = 0;
  const T = (name) => ({ id: id('t'), name, createdAt: Date.now(), scrollTop: 0, zoom: 1 });
  const personal = T('Personal');
  const school = T('School');
  const business = T('Business Ideas');
  const random = T('Random Thoughts');
  const projects = T('Projects');
  const shopping = T('Shopping List');
  const goals = T('Goals');
  const movies = T('Movies & Shows');

  const notes = [
    ...wall(
      personal.id,
      [
        ['Welcome to POST IT', '- Click a note to write in it\n- Drag the tape to move it\n- Type \\ for lists, checklists, tables and more\n- Press N for a new note\n\nThe ⋯ menu has colors, tilt and connections.', 'yellow', {w: 250 }],
        ['Call grandma', 'Sunday after lunch. Ask about the garden and the lemon cake recipe.', 'pink', { stickers: [['❤️', 'br']] }],
        ['Dentist', 'Thursday 2:30 pm\nBring insurance card', 'blue', {}],
        ['Morning routine', '- [x] Glass of water first\n- [ ] Stretch 10 min\n- [ ] No phone until 9', 'mint'],
        ['', 'You don’t have to have it all figured out to move forward.', 'white', { w: 200 }],
        ['Weekend', '- Farmers market\n- Fix the bike light\n- Long walk somewhere new', 'orange'],
        ['Books to read', '- The Overstory\n- Piranesi\n- Four Thousand Weeks', 'lavender'],
        ['Passwords', 'Move everything into the password manager. Turn on 2FA for email.', 'gray', { w: 200 }],
      ],
      11,
    ),
    ...wall(
      school.id,
      [
        ['Biology exam', 'Chapters 4–7\nCell respiration diagrams\nPractice test on Friday', 'blue', {}],
        ['Essay outline', '1. Hook — the river as a character\n2. Three turning points\n3. What changes, what doesn’t', 'yellow', { w: 250 }],
        ['Study group', 'Tue + Thu, library 3rd floor.\nBring flashcards.', 'mint'],
        ['Formulas', 'v = d / t\nF = m · a\nP = W / t', 'white'],
        ['Ask the professor', 'Can the final project be a podcast instead of a paper?', 'pink'],
      ],
      3,
    ),
    ...wall(
      random.id,
      [
        ['', 'Why do we say “sleep like a baby” when babies wake up every two hours?', 'lavender'],
        ['Shower thought', 'Every book you’ve read is a conversation with someone you never met.', 'yellow'],
        ['', 'A museum of ordinary objects from 2026. What would be in it?', 'mint'],
        ['Words I like', 'Petrichor\nSonder\nVellichor', 'white'],
      ],
      21,
    ),
    ...wall(
      projects.id,
      [
        ['Kitchen shelf', 'Oak board 90 cm\nTwo steel brackets\nWall anchors (6 mm)\nSand + oil finish', 'orange', {}],
        ['Portfolio site', 'Pick 6 best pieces\nWrite short case studies\nOne page, fast, no fluff', 'blue'],
        ['Balcony garden', 'Basil, mint, cherry tomatoes. Self-watering pots?', 'mint'],
      ],
      5,
    ),
    ...wall(
      shopping.id,
      [
        ['Groceries', '- [ ] Oat milk\n- [x] Eggs\n- [ ] Spinach\n- [x] Lemons\n- [ ] Sourdough\n- [ ] Coffee beans', 'yellow', { w: 200 }],
        ['Hardware store', '- [ ] Picture hooks\n- [ ] AA batteries\n- [ ] Wood glue', 'gray'],
        ['Gifts', 'Mom — ceramic mug\nSam — climbing chalk bag', 'pink'],
      ],
      9,
    ),
    ...wall(
      goals.id,
      [
        ['This year', 'Run a half marathon\nRead 20 books\nCook something new every week', 'mint', {w: 240 }],
        ['Learn', 'Spanish — 15 min a day\nBasic woodworking', 'blue'],
        ['Save', 'Emergency fund: 3 months of expenses', 'yellow'],
      ],
      13,
    ),
    ...wall(
      movies.id,
      [
        ['Watch next', '- [ ] Past Lives\n- [ ] The Bear S3\n- [x] Perfect Days', 'lavender'],
        ['Rewatch', 'Spirited Away\nArrival', 'pink'],
        ['Recommended by Alex', 'Severance — “just trust me on the first two episodes”', 'white', { w: 230 }],
      ],
      17,
    ),
  ];

  const ideaA = id('n');
  const ideaB = id('n');
  const ideaC = id('n');
  const ideaD = id('n');
  notes.push(
    ...wall(
      business.id,
      [
        ['Neighborhood tool library', 'Rent drills, ladders, and saws by the day. Members pay monthly. Start with one garage.', 'yellow', { id: ideaA, w: 250, col: 0, stickers: [['🔥', 'tr'], ['👍', 'br']] }],
        ['Pricing thoughts', '| Plan | Price |\n| --- | --- |\n| Basic | $9 / mo |\n| Delivery | $19 / mo |\n| Trial | 1 week free |', 'mint', { id: ideaB, col: 1 }],
        ['Questions to validate', 'Would people actually share tools?\nInsurance?\nWho handles repairs?', 'pink', { id: ideaC, col: 0, w: 240 }],
        ['Plant subscription', 'Monthly houseplant + care card. Partner with local nurseries.', 'blue', { id: ideaD, col: 3 }],
        ['Name ideas', '- Borrowed\n- Shed Club\n- Lendly', 'lavender', { col: 1 }],
        ['Next step', 'Talk to 10 neighbors this week.', 'orange', { col: 2, stickers: [['🚀', 'tr']] }],
      ],
      29,
    ),
  );

  const connections = [
    { id: id('c'), topicId: business.id, from: ideaA, to: ideaB },
    { id: id('c'), topicId: business.id, from: ideaA, to: ideaC },
  ];

  return {
    version: 1,
    topics: [personal, school, business, random, projects, shopping, goals, movies],
    notes,
    connections,
    activeTopicId: personal.id,
    settings: { userName: '', tilt: true, showConnections: true, newNoteColor: 'random' },
  };
}

/* What a brand-new user sees: one topic and one note with the basics. */
export function createStarterData() {
  seq = 0;
  const topic = { id: id('t'), name: 'My Notes', createdAt: Date.now(), scrollTop: 0, zoom: 1 };
  const notes = wall(
    topic.id,
    [
      [
        'Welcome to POST IT',
        '- Click a note to write in it\n- Drag the tape to move it\n- Type \\ for lists, checklists, tables and more\n- Press N for a new note\n- Add topics with New Topic on the left\n\nDelete this note whenever you like.',
        'yellow',
        { w: 260, rotation: -1.2 },
      ],
    ],
    3,
  );
  return { topics: [topic], notes, connections: [], activeTopicId: topic.id };
}
