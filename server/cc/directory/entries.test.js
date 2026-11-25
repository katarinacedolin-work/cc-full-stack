const fs = require('fs');
const path = require('path');
const { checkEntry, checkFile, toDirectory } = require('./entries');

const agent = {
  id: 'agent-example',
  name: 'Camila Reyes',
  brokerage: 'College Area Homes',
  focus: 'College Area',
  summary: 'Studios and shared houses a short walk from campus.',
  website: 'https://example.com/camila',
};

const service = {
  id: 'mslc',
  category: 'Learn',
  title: 'Math & Science Learning Center',
  provider: 'Love Library Room 328',
  hours: 'Drop in',
  description: 'Free drop-in tutoring.',
  website: 'https://mslc.sdsu.edu/',
};

const building = {
  id: 'apt-plaza',
  title: 'South Campus Plaza',
  kicker: 'On campus',
  meta: 'Trolley stop downstairs',
  price: 'From $1,650/mo',
  summary: 'Studios and shared units.',
  facts: [['Where', 'South Campus Plaza']],
};

describe('checkEntry', () => {
  it('accepts an agent and fills in a color', () => {
    expect(checkEntry('agent', agent)).toEqual({
      id: 'agent-example',
      kind: 'agent',
      details: {
        name: 'Camila Reyes',
        brokerage: 'College Area Homes',
        focus: 'College Area',
        summary: 'Studios and shared houses a short walk from campus.',
        website: 'https://example.com/camila',
        accent: 'coral',
      },
    });
  });

  it('accepts a school service and gives its link a label', () => {
    expect(checkEntry('school-service', service).details).toMatchObject({
      websiteLabel: 'Visit website',
      emoji: '🏫',
    });
  });

  it('accepts an apartment building with its facts', () => {
    expect(checkEntry('apartment', building).details.facts).toEqual([
      ['Where', 'South Campus Plaza'],
    ]);
  });

  it('names the entry and the field that is missing', () => {
    expect(() => checkEntry('agent', { ...agent, brokerage: '' })).toThrow(
      'agent "agent-example": needs brokerage'
    );
    expect(() => checkEntry('agent', { ...agent, website: undefined })).toThrow('needs website');
  });

  it('only takes a web link as a website', () => {
    expect(() => checkEntry('agent', { ...agent, website: 'javascript:alert(1)' })).toThrow(
      'website has to start with https:// or http://'
    );
    expect(() => checkEntry('agent', { ...agent, website: 'example.com' })).toThrow('website');
  });

  it('refuses a bad id, an unknown color, a fact that is not a pair, and an unknown kind', () => {
    expect(() => checkEntry('agent', { ...agent, id: 'Agent Camila' })).toThrow('needs an id');
    expect(() => checkEntry('agent', { ...agent, accent: 'cobalt' })).toThrow('accent has to be');
    expect(() => checkEntry('apartment', { ...building, facts: [['Where']] })).toThrow(
      'each fact is a [label, value] pair'
    );
    expect(() => checkEntry('store', agent)).toThrow('is not a kind of entry');
  });
});

describe('checkFile', () => {
  it('keeps the order of each list', () => {
    const entries = checkFile({
      schoolServices: [service],
      agents: [agent, { ...agent, id: 'agent-two' }],
    });
    expect(entries.map(entry => [entry.kind, entry.id, entry.position])).toEqual([
      ['school-service', 'mslc', 0],
      ['agent', 'agent-example', 0],
      ['agent', 'agent-two', 1],
    ]);
  });

  it('refuses an id that is used twice, even across kinds', () => {
    expect(() =>
      checkFile({ agents: [agent], apartments: [{ ...building, id: agent.id }] })
    ).toThrow('The id "agent-example" is used twice');
  });

  it('refuses a list that is not a list', () => {
    expect(() => checkFile({ agents: {} })).toThrow('agents has to be a list');
  });

  it('accepts the seed file in this repository', () => {
    const file = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'db', 'seed', 'directory.json'), 'utf8')
    );
    expect(checkFile(file).length).toBeGreaterThan(0);
  });
});

describe('toDirectory', () => {
  const rowOf = (kind, entry) => ({ ...checkEntry(kind, entry), hidden: false });

  it('groups entries the way the pages load them, and gives an agent initials', () => {
    const directory = toDirectory([
      rowOf('agent', agent),
      rowOf('apartment', building),
      rowOf('school-service', service),
    ]);
    expect(directory.agents).toEqual([
      expect.objectContaining({ id: 'agent-example', initials: 'CR' }),
    ]);
    expect(directory.apartments).toEqual([expect.objectContaining({ id: 'apt-plaza' })]);
    expect(directory.schoolServices).toEqual([expect.objectContaining({ id: 'mslc' })]);
  });

  it('leaves out an entry whose link is not a web link, however it got stored', () => {
    const row = rowOf('agent', agent);
    row.details.website = 'javascript:alert(1)';
    expect(toDirectory([row]).agents).toEqual([]);
  });
});
