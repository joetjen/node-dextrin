import { expect } from 'chai';
import { decode, Registry, Schema } from '../../src/dextrin.js';

// B8 of `design/implementation-plan.md`: the version discipline check. A
// schema whose content changed needs a new version, a version never goes
// down, and the latest version lists which older ones its materializer
// has to upgrade, with what changed.
const loaded = (sources) => sources.reduce((registry, source) => Schema.compile(decode(source), registry), new Registry());

const V1 = '%{User: %schema{name: :string}}';
const V2 = '%{User: %schema(2){name: :string, email?: :string}}';

describe('the version discipline check', () => {
  it('the same schemas pass with nothing to report', () => {
    expect(Schema.compat(loaded([V1, V2]), loaded([V1, V2]))).to.deep.equal({
      problems: [],
      upgrades: [{ schema: 'User', from: 1, to: 2, added: ['email'], removed: [], changed: [] }],
    });
  });

  it('a new version passes', () => {
    expect(Schema.compat(loaded([V1]), loaded([V1, V2])).problems).to.deep.equal([]);
  });

  it('a version whose content changed without a new version is a problem', () => {
    const changed = '%{User: %schema{name: :string, nick?: :string}}';
    expect(Schema.compat(loaded([V1]), loaded([changed])).problems).to.deep.equal([
      { schema: 'User', version: 1, problem: 'changed-without-new-version' },
    ]);
  });

  it('a changed type, requiredness or default is a change; a description is not', () => {
    const base = '%{User: %schema{name: :string}}';
    for (const changed of [
      '%{User: %schema{name: :integer}}',
      '%{User: %schema{name?: :string}}',
      '%{User: %schema{name: %field{type: :string, default: "x"}}}',
    ]) {
      expect(Schema.compat(loaded([base]), loaded([changed])).problems).to.have.length(1);
    }
    const described = '%{User: %schema{name: %field{type: :string, description: "the name"}}}';
    expect(Schema.compat(loaded([base]), loaded([described])).problems).to.deep.equal([]);
  });

  it('a version that went down is a problem', () => {
    expect(Schema.compat(loaded([V1, V2]), loaded([V1])).problems).to.deep.equal([
      { schema: 'User', problem: 'version-went-down', from: 2, to: 1 },
    ]);
  });

  it('the upgrade checklist says what changed since each older version', () => {
    const v3 = '%{User: %schema(3){name: :integer, email?: :string, id: :uuid}}';
    const { upgrades } = Schema.compat(loaded([V1, V2]), loaded([V1, V2, v3]));
    expect(upgrades).to.deep.include({ schema: 'User', from: 1, to: 3, added: ['email', 'id'], removed: [], changed: ['name'] });
    expect(upgrades).to.deep.include({ schema: 'User', from: 2, to: 3, added: ['id'], removed: [], changed: ['name'] });
  });

  it('a new schema is not a problem', () => {
    expect(Schema.compat(loaded([V1]), loaded([V1, '%{Other: %schema{x: :integer}}'])).problems).to.deep.equal([]);
  });
});
