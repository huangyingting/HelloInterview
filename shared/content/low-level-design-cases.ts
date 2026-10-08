import type { ExampleCase, Problem, WorkedSolution } from '../types';

const inventoryCode = `class InventoryLedger {
  #available;
  #committed = 0;
  #reservations = new Map();
  constructor(units) { this.#available = units; }
  apply(command) {
    const existing = this.#reservations.get(command.id);
    if (command.op === 'reserve') {
      if (existing && existing.quantity !== command.quantity) return ['conflict'];
      if (existing) return existing.status === 'reserved' ? ['held', existing.quantity] : ['closed', existing.status];
      if (command.quantity > this.#available) return ['insufficient'];
      this.#available -= command.quantity;
      this.#reservations.set(command.id, { quantity: command.quantity, status: 'reserved' });
      return ['held', command.quantity];
    }
    if (!existing) return ['missing'];
    if (existing.status !== 'reserved') return ['closed', existing.status];
    if (command.op === 'release') {
      this.#available += existing.quantity;
      existing.status = 'released';
      return ['released', existing.quantity];
    }
    if (command.op === 'commit') {
      this.#committed += existing.quantity;
      existing.status = 'committed';
      return ['committed', existing.quantity];
    }
    throw new Error('Unsupported ledger command.');
  }
  snapshot() {
    return { available: this.#available, committed: this.#committed,
      reservations: [...this.#reservations].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
        .map(([id, record]) => [id, record.quantity, record.status]) };
  }
}
function solve(input) {
  const ledger = new InventoryLedger(input.units);
  const results = input.commands.map(command => ledger.apply(command));
  return { results, state: ledger.snapshot() };
}`;

const cacheCode = `class LruCache {
  #capacity;
  #entries = new Map();
  constructor(capacity) { this.#capacity = capacity; }
  apply(command) {
    if (command.op === 'put') {
      this.#entries.delete(command.key);
      this.#entries.set(command.key, command.value);
      if (this.#entries.size > this.#capacity) this.#entries.delete(this.#entries.keys().next().value);
      return ['stored'];
    }
    if (command.op !== 'get' && command.op !== 'peek') throw new Error('Unsupported cache command.');
    if (!this.#entries.has(command.key)) return ['miss'];
    const value = this.#entries.get(command.key);
    if (command.op === 'get') { this.#entries.delete(command.key); this.#entries.set(command.key, value); }
    return ['hit', value];
  }
  snapshot() { return [...this.#entries]; }
}
function solve(input) {
  const cache = new LruCache(input.capacity);
  return { results: input.commands.map(command => cache.apply(command)), entries: cache.snapshot() };
}`;

const workflowCode = `class ApprovalWorkflow {
  #state = 'draft';
  #version = 0;
  #receipts = new Map();
  apply(command) {
    const prior = this.#receipts.get(command.id);
    if (prior) {
      if (prior.event !== command.event || prior.expectedVersion !== command.expectedVersion)
        return ['identity-conflict', this.#state, this.#version];
      return [...prior.result];
    }
    let result;
    if (command.expectedVersion !== this.#version) result = ['stale', this.#state, this.#version];
    else {
      const transitions = this.#state === 'draft' ? new Map([['submit', 'submitted'], ['cancel', 'cancelled']])
        : this.#state === 'submitted' ? new Map([['approve', 'approved'], ['cancel', 'cancelled']]) : new Map();
      if (!transitions.has(command.event)) result = ['illegal', this.#state, this.#version];
      else { this.#state = transitions.get(command.event); this.#version++; result = ['accepted', this.#state, this.#version]; }
    }
    this.#receipts.set(command.id, { event: command.event, expectedVersion: command.expectedVersion, result: [...result] });
    return result;
  }
  snapshot() { return { state: this.#state, version: this.#version }; }
}
function solve(input) {
  const workflow = new ApprovalWorkflow();
  const results = input.commands.map(command => workflow.apply(command));
  return { results, ...workflow.snapshot() };
}`;

const catalogCode = `class FileCatalog {
  #nodes = new Map([['/', { kind: 'dir' }]]);
  apply(command) {
    const { op, path } = command;
    const node = this.#nodes.get(path);
    if (op === 'read') return !node ? ['not-found'] : node.kind !== 'file' ? ['wrong-kind'] : ['content', node.content];
    if (op === 'list') {
      if (!node) return ['not-found'];
      if (node.kind !== 'dir') return ['wrong-kind'];
      const prefix = path === '/' ? '/' : path + '/';
      return ['children', [...this.#nodes.keys()].filter(key => key.startsWith(prefix) && key !== path)
        .map(key => key.slice(prefix.length)).filter(name => name && !name.includes('/')).sort()];
    }
    if (op === 'remove') {
      if (path === '/') return ['root-protected'];
      if (!node) return ['not-found'];
      if (node.kind === 'dir' && [...this.#nodes.keys()].some(key => key.startsWith(path + '/'))) return ['not-empty'];
      this.#nodes.delete(path);
      return ['removed'];
    }
    if (op !== 'mkdir' && op !== 'write') throw new Error('Unsupported catalog command.');
    if (path === '/') return op === 'mkdir' ? ['exists'] : ['wrong-kind'];
    const parentPath = path.slice(0, path.lastIndexOf('/')) || '/';
    const parent = this.#nodes.get(parentPath);
    if (!parent) return ['parent-missing'];
    if (parent.kind !== 'dir') return ['parent-not-directory'];
    if (op === 'mkdir') {
      if (node) return ['exists'];
      this.#nodes.set(path, { kind: 'dir' });
      return ['created'];
    }
    if (node && node.kind !== 'file') return ['wrong-kind'];
    this.#nodes.set(path, { kind: 'file', content: command.content });
    return ['written'];
  }
  snapshot() { return [...this.#nodes].map(([path, node]) => [path, node.kind]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0); }
}
function solve(input) {
  const catalog = new FileCatalog();
  return { results: input.commands.map(command => catalog.apply(command)), paths: catalog.snapshot() };
}`;

const parcelCode = `class ParcelDepot {
  #lockers;
  #serial = 0;
  constructor(lockers) { this.#lockers = lockers.map(locker => ({ ...locker, parcel: null })).sort((a, b) => a.size - b.size || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); }
  apply(command) {
    for (const locker of this.#lockers) if (locker.parcel && locker.parcel.expiresAt <= command.at) locker.parcel = null;
    if (command.op === 'tick') return ['tick'];
    if (command.op === 'pickup') {
      const locker = this.#lockers.find(item => item.parcel && item.parcel.code === command.code);
      if (!locker) return ['missing'];
      const id = locker.parcel.id; locker.parcel = null; return ['picked', id];
    }
    if (command.op !== 'place') throw new Error('Unsupported parcel command.');
    if (command.expiresAt <= command.at) return ['invalid-expiry'];
    if (this.#lockers.some(locker => locker.parcel && locker.parcel.id === command.id)) return ['duplicate-package'];
    const locker = this.#lockers.find(item => !item.parcel && item.size >= command.size);
    if (!locker) return ['full'];
    const code = 'pickup-' + (++this.#serial);
    locker.parcel = { id: command.id, expiresAt: command.expiresAt, code };
    return ['placed', locker.id, code];
  }
  snapshot() { return this.#lockers.map(locker => [locker.id, locker.parcel ? locker.parcel.id : null]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0); }
}
function solve(input) {
  const depot = new ParcelDepot(input.lockers);
  return { results: input.commands.map(command => depot.apply(command)), occupancy: depot.snapshot() };
}`;

const parkingCode = `class ParkingGarage {
  #spaces;
  #tickets = new Map();
  #price;
  constructor(spaces, price) { this.#spaces = spaces.map(space => ({ ...space, ticket: null })).sort((a, b) => a.size - b.size || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); this.#price = price; }
  apply(command) {
    const ticket = this.#tickets.get(command.ticketId);
    if (command.op === 'enter') {
      if (ticket) return ['duplicate'];
      const space = this.#spaces.find(item => item.ticket === null && item.size >= command.size);
      if (!space) return ['full'];
      space.ticket = command.ticketId;
      this.#tickets.set(command.ticketId, { space, startedAt: command.at, closed: false, charge: null });
      return ['entered', space.id];
    }
    if (command.op !== 'exit') throw new Error('Unsupported garage command.');
    if (!ticket) return ['missing'];
    if (ticket.closed) return ['already-closed'];
    const charge = this.#price(command.at - ticket.startedAt);
    ticket.charge = charge; ticket.closed = true; ticket.space.ticket = null;
    return ['closed', charge];
  }
  snapshot() { return { spaces: this.#spaces.map(space => [space.id, space.ticket]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
    tickets: [...this.#tickets].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).map(([id, ticket]) => [id, ticket.closed ? 'closed' : 'active', ticket.charge]) }; }
}
function solve(input) {
  const garage = new ParkingGarage(input.spaces, duration => Math.ceil(duration / 60000) * input.rateCents);
  const results = input.commands.map(command => garage.apply(command));
  return { results, ...garage.snapshot() };
}`;

const boardCode = `class GridGame {
  #board = Array(9).fill(null);
  #turn = 'X';
  #winner = null;
  #done = false;
  apply(move) {
    if (this.#done) return ['finished'];
    if (move.player !== this.#turn) return ['wrong-turn'];
    const index = move.row * 3 + move.column;
    if (this.#board[index] !== null) return ['occupied'];
    this.#board[index] = move.player;
    const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    if (lines.some(line => line.every(cell => this.#board[cell] === move.player))) {
      this.#winner = move.player; this.#done = true; return ['won', move.player];
    }
    if (this.#board.every(cell => cell !== null)) { this.#done = true; return ['draw']; }
    this.#turn = this.#turn === 'X' ? 'O' : 'X';
    return ['played', move.player];
  }
  snapshot() { return { board: [this.#board.slice(0,3),this.#board.slice(3,6),this.#board.slice(6,9)], next: this.#done ? null : this.#turn, winner: this.#winner, draw: this.#done && this.#winner === null }; }
}
function solve(input) {
  const game = new GridGame();
  const results = input.moves.map(move => game.apply(move));
  return { results, ...game.snapshot() };
}`;

const limiterCode = `class FixedWindowPolicy {
  #limit;
  #window;
  #maximum;
  #clients = new Map();
  constructor(limit, windowMs, maxKeys) { this.#limit = limit; this.#window = windowMs; this.#maximum = maxKeys; }
  allow(key, at) {
    for (const [id, bucket] of this.#clients) if (bucket.start + this.#window <= at) this.#clients.delete(id);
    let bucket = this.#clients.get(key);
    if (!bucket) {
      if (this.#clients.size >= this.#maximum) {
        const expiry = Math.min(...[...this.#clients.values()].map(value => value.start + this.#window));
        return [false, expiry - at, 'capacity'];
      }
      bucket = { start: Math.floor(at / this.#window) * this.#window, count: 0 };
      this.#clients.set(key, bucket);
    }
    if (bucket.count >= this.#limit) return [false, bucket.start + this.#window - at, 'rate'];
    bucket.count++;
    return [true, 0, 'allowed'];
  }
  snapshot() { return [...this.#clients.keys()].sort(); }
}
function solve(input) {
  const policy = new FixedWindowPolicy(input.limit, input.windowMs, input.maxKeys);
  return { results: input.requests.map(request => policy.allow(request.key, request.at)), activeKeys: policy.snapshot() };
}`;

const inventoryExamples: ExampleCase[] = [
  { label: 'No commands conserve capacity', input: { units: 3, commands: [] }, expected: { results: [], state: { available: 3, committed: 0, reservations: [] } } },
  { label: 'Insufficient request does not allocate identity', input: { units: 0, commands: [{ op: 'reserve', id: 'a', quantity: 1 }] }, expected: { results: [['insufficient']], state: { available: 0, committed: 0, reservations: [] } } },
  { label: 'Repeated reservation does not consume twice', input: { units: 5, commands: [{ op: 'reserve', id: 'a', quantity: 2 }, { op: 'reserve', id: 'a', quantity: 2 }] }, expected: { results: [['held', 2], ['held', 2]], state: { available: 3, committed: 0, reservations: [['a', 2, 'reserved']] } } },
  { label: 'Changed quantity conflicts', input: { units: 5, commands: [{ op: 'reserve', id: 'a', quantity: 2 }, { op: 'reserve', id: 'a', quantity: 3 }] }, expected: { results: [['held', 2], ['conflict']], state: { available: 3, committed: 0, reservations: [['a', 2, 'reserved']] } } },
  { label: 'Release is not applied twice', input: { units: 3, commands: [{ op: 'reserve', id: 'a', quantity: 3 }, { op: 'release', id: 'a' }, { op: 'release', id: 'a' }] }, expected: { results: [['held', 3], ['released', 3], ['closed', 'released']], state: { available: 3, committed: 0, reservations: [['a', 3, 'released']] } } },
  { label: 'Commit keeps units out of availability', input: { units: 4, commands: [{ op: 'commit', id: 'missing' }, { op: 'reserve', id: '__proto__', quantity: 2 }, { op: 'commit', id: '__proto__' }, { op: 'release', id: '__proto__' }] }, expected: { results: [['missing'], ['held', 2], ['committed', 2], ['closed', 'committed']], state: { available: 2, committed: 2, reservations: [['__proto__', 2, 'committed']] } } },
];
const cacheExamples: ExampleCase[] = [
  { label: 'Empty trace', input: { capacity: 2, commands: [] }, expected: { results: [], entries: [] } },
  { label: 'Zero capacity never retains', input: { capacity: 0, commands: [{ op: 'put', key: 'a', value: 1 }, { op: 'get', key: 'a' }] }, expected: { results: [['stored'], ['miss']], entries: [] } },
  { label: 'Get refreshes recency before eviction', input: { capacity: 2, commands: [{ op: 'put', key: 'a', value: 1 }, { op: 'put', key: 'b', value: 2 }, { op: 'get', key: 'a' }, { op: 'put', key: 'c', value: 3 }, { op: 'get', key: 'b' }] }, expected: { results: [['stored'], ['stored'], ['hit', 1], ['stored'], ['miss']], entries: [['a', 1], ['c', 3]] } },
  { label: 'Peek does not refresh recency', input: { capacity: 2, commands: [{ op: 'put', key: 'a', value: 1 }, { op: 'put', key: 'b', value: 2 }, { op: 'peek', key: 'a' }, { op: 'put', key: 'c', value: 3 }] }, expected: { results: [['stored'], ['stored'], ['hit', 1], ['stored']], entries: [['b', 2], ['c', 3]] } },
  { label: 'Replacement is one entry', input: { capacity: 1, commands: [{ op: 'put', key: 'a', value: 1 }, { op: 'put', key: 'a', value: 0 }, { op: 'get', key: 'a' }] }, expected: { results: [['stored'], ['stored'], ['hit', 0]], entries: [['a', 0]] } },
  { label: 'Property-looking keys are ordinary identifiers', input: { capacity: 2, commands: [{ op: 'put', key: 'constructor', value: 5 }, { op: 'get', key: '__proto__' }, { op: 'put', key: '__proto__', value: -1 }, { op: 'get', key: 'constructor' }] }, expected: { results: [['stored'], ['miss'], ['stored'], ['hit', 5]], entries: [['__proto__', -1], ['constructor', 5]] } },
];
const workflowExamples: ExampleCase[] = [
  { label: 'Initial state', input: { commands: [] }, expected: { results: [], state: 'draft', version: 0 } },
  { label: 'Approval before submission is illegal', input: { commands: [{ id: 'a', event: 'approve', expectedVersion: 0 }] }, expected: { results: [['illegal', 'draft', 0]], state: 'draft', version: 0 } },
  { label: 'Submit then approve', input: { commands: [{ id: 'a', event: 'submit', expectedVersion: 0 }, { id: 'b', event: 'approve', expectedVersion: 1 }] }, expected: { results: [['accepted', 'submitted', 1], ['accepted', 'approved', 2]], state: 'approved', version: 2 } },
  { label: 'Stale command leaves version intact', input: { commands: [{ id: 'a', event: 'submit', expectedVersion: 0 }, { id: 'b', event: 'approve', expectedVersion: 0 }] }, expected: { results: [['accepted', 'submitted', 1], ['stale', 'submitted', 1]], state: 'submitted', version: 1 } },
  { label: 'Retry replays historical receipt', input: { commands: [{ id: 'a', event: 'submit', expectedVersion: 0 }, { id: 'b', event: 'cancel', expectedVersion: 1 }, { id: 'a', event: 'submit', expectedVersion: 0 }] }, expected: { results: [['accepted', 'submitted', 1], ['accepted', 'cancelled', 2], ['accepted', 'submitted', 1]], state: 'cancelled', version: 2 } },
  { label: 'Reuse with different parameters is explicit', input: { commands: [{ id: '__proto__', event: 'submit', expectedVersion: 0 }, { id: '__proto__', event: 'cancel', expectedVersion: 1 }, { id: 'c', event: 'submit', expectedVersion: 1 }] }, expected: { results: [['accepted', 'submitted', 1], ['identity-conflict', 'submitted', 1], ['illegal', 'submitted', 1]], state: 'submitted', version: 1 } },
];
const catalogExamples: ExampleCase[] = [
  { label: 'Root exists initially', input: { commands: [] }, expected: { results: [], paths: [['/', 'dir']] } },
  { label: 'Missing parent is not implicitly created', input: { commands: [{ op: 'write', path: '/a/b', content: 'x' }] }, expected: { results: [['parent-missing']], paths: [['/', 'dir']] } },
  { label: 'Write and replacement preserve kind', input: { commands: [{ op: 'mkdir', path: '/a' }, { op: 'write', path: '/a/f', content: 'x' }, { op: 'write', path: '/a/f', content: 'y' }, { op: 'read', path: '/a/f' }] }, expected: { results: [['created'], ['written'], ['written'], ['content', 'y']], paths: [['/', 'dir'], ['/a', 'dir'], ['/a/f', 'file']] } },
  { label: 'Deletion is nonrecursive and root is protected', input: { commands: [{ op: 'mkdir', path: '/a' }, { op: 'write', path: '/a/f', content: '' }, { op: 'remove', path: '/a' }, { op: 'remove', path: '/' }] }, expected: { results: [['created'], ['written'], ['not-empty'], ['root-protected']], paths: [['/', 'dir'], ['/a', 'dir'], ['/a/f', 'file']] } },
  { label: 'List direct children in ASCII order', input: { commands: [{ op: 'mkdir', path: '/z' }, { op: 'mkdir', path: '/a' }, { op: 'write', path: '/a/f', content: 'x' }, { op: 'list', path: '/' }, { op: 'list', path: '/a' }] }, expected: { results: [['created'], ['created'], ['written'], ['children', ['a', 'z']], ['children', ['f']]], paths: [['/', 'dir'], ['/a', 'dir'], ['/a/f', 'file'], ['/z', 'dir']] } },
  { label: 'File cannot be a directory and special names are ordinary', input: { commands: [{ op: 'write', path: '/constructor', content: 'v' }, { op: 'mkdir', path: '/constructor/a' }, { op: 'list', path: '/constructor' }, { op: 'read', path: '/missing' }, { op: 'remove', path: '/constructor' }] }, expected: { results: [['written'], ['parent-not-directory'], ['wrong-kind'], ['not-found'], ['removed']], paths: [['/', 'dir']] } },
];
const parcelExamples: ExampleCase[] = [
  { label: 'Empty facility', input: { lockers: [], commands: [{ op: 'place', id: 'p', size: 1, expiresAt: 5, at: 0 }] }, expected: { results: [['full']], occupancy: [] } },
  { label: 'Smallest fit with deterministic tie', input: { lockers: [{ id: 'b', size: 2 }, { id: 'a', size: 2 }, { id: 'c', size: 3 }], commands: [{ op: 'place', id: 'p', size: 2, expiresAt: 5, at: 0 }] }, expected: { results: [['placed', 'a', 'pickup-1']], occupancy: [['a', 'p'], ['b', null], ['c', null]] } },
  { label: 'Pickup frees occupancy once', input: { lockers: [{ id: 'a', size: 1 }], commands: [{ op: 'place', id: 'p', size: 1, expiresAt: 5, at: 0 }, { op: 'pickup', code: 'pickup-1', at: 1 }, { op: 'pickup', code: 'pickup-1', at: 2 }] }, expected: { results: [['placed', 'a', 'pickup-1'], ['picked', 'p'], ['missing']], occupancy: [['a', null]] } },
  { label: 'Expiry is inclusive', input: { lockers: [{ id: 'a', size: 1 }], commands: [{ op: 'place', id: 'p', size: 1, expiresAt: 5, at: 0 }, { op: 'pickup', code: 'pickup-1', at: 5 }] }, expected: { results: [['placed', 'a', 'pickup-1'], ['missing']], occupancy: [['a', null]] } },
  { label: 'Duplicate active package is rejected', input: { lockers: [{ id: 'a', size: 1 }, { id: 'b', size: 1 }], commands: [{ op: 'place', id: 'p', size: 1, expiresAt: 5, at: 0 }, { op: 'place', id: 'p', size: 1, expiresAt: 6, at: 1 }] }, expected: { results: [['placed', 'a', 'pickup-1'], ['duplicate-package']], occupancy: [['a', 'p'], ['b', null]] } },
  { label: 'Expired occupancy is reusable without code reuse', input: { lockers: [{ id: 'a', size: 1 }], commands: [{ op: 'place', id: 'p', size: 1, expiresAt: 2, at: 0 }, { op: 'tick', at: 2 }, { op: 'place', id: 'q', size: 1, expiresAt: 4, at: 2 }] }, expected: { results: [['placed', 'a', 'pickup-1'], ['tick'], ['placed', 'a', 'pickup-2']], occupancy: [['a', 'q']] } },
];
const parkingExamples: ExampleCase[] = [
  { label: 'No available space', input: { spaces: [], rateCents: 10, commands: [{ op: 'enter', ticketId: 't', size: 1, at: 0 }] }, expected: { results: [['full']], spaces: [], tickets: [] } },
  { label: 'Exact minute costs one rate unit', input: { spaces: [{ id: 'a', size: 1 }], rateCents: 10, commands: [{ op: 'enter', ticketId: 't', size: 1, at: 0 }, { op: 'exit', ticketId: 't', at: 60000 }] }, expected: { results: [['entered', 'a'], ['closed', 10]], spaces: [['a', null]], tickets: [['t', 'closed', 10]] } },
  { label: 'Next millisecond starts another billing minute', input: { spaces: [{ id: 'a', size: 1 }], rateCents: 10, commands: [{ op: 'enter', ticketId: 't', size: 1, at: 0 }, { op: 'exit', ticketId: 't', at: 60001 }] }, expected: { results: [['entered', 'a'], ['closed', 20]], spaces: [['a', null]], tickets: [['t', 'closed', 20]] } },
  { label: 'Zero stay and duplicate checkout', input: { spaces: [{ id: 'a', size: 1 }], rateCents: 10, commands: [{ op: 'enter', ticketId: 't', size: 1, at: 0 }, { op: 'exit', ticketId: 't', at: 0 }, { op: 'exit', ticketId: 't', at: 1 }] }, expected: { results: [['entered', 'a'], ['closed', 0], ['already-closed']], spaces: [['a', null]], tickets: [['t', 'closed', 0]] } },
  { label: 'Occupied space cannot be reassigned', input: { spaces: [{ id: 'a', size: 2 }], rateCents: 10, commands: [{ op: 'enter', ticketId: 't', size: 2, at: 0 }, { op: 'enter', ticketId: 'u', size: 1, at: 1 }, { op: 'enter', ticketId: 't', size: 1, at: 2 }] }, expected: { results: [['entered', 'a'], ['full'], ['duplicate']], spaces: [['a', 't']], tickets: [['t', 'active', null]] } },
  { label: 'Missing ticket and compatible size selection', input: { spaces: [{ id: 'b', size: 3 }, { id: 'a', size: 1 }], rateCents: 0, commands: [{ op: 'exit', ticketId: 'x', at: 0 }, { op: 'enter', ticketId: 't', size: 2, at: 1 }] }, expected: { results: [['missing'], ['entered', 'b']], spaces: [['a', null], ['b', 't']], tickets: [['t', 'active', null]] } },
];
const boardExamples: ExampleCase[] = [
  { label: 'Initial board', input: { moves: [] }, expected: { results: [], board: [[null,null,null],[null,null,null],[null,null,null]], next: 'X', winner: null, draw: false } },
  { label: 'Wrong starting player', input: { moves: [{ player: 'O', row: 0, column: 0 }] }, expected: { results: [['wrong-turn']], board: [[null,null,null],[null,null,null],[null,null,null]], next: 'X', winner: null, draw: false } },
  { label: 'Occupied cell leaves turn unchanged', input: { moves: [{ player: 'X', row: 0, column: 0 }, { player: 'O', row: 0, column: 0 }] }, expected: { results: [['played','X'],['occupied']], board: [['X',null,null],[null,null,null],[null,null,null]], next: 'O', winner: null, draw: false } },
  { label: 'Diagonal victory', input: { moves: [{ player:'X',row:0,column:0 },{ player:'O',row:0,column:1 },{ player:'X',row:1,column:1 },{ player:'O',row:0,column:2 },{ player:'X',row:2,column:2 }] }, expected: { results: [['played','X'],['played','O'],['played','X'],['played','O'],['won','X']], board: [['X','O','O'],[null,'X',null],[null,null,'X']], next: null, winner: 'X', draw: false } },
  { label: 'Finished game rejects later moves', input: { moves: [{ player:'X',row:0,column:0 },{ player:'O',row:1,column:0 },{ player:'X',row:0,column:1 },{ player:'O',row:1,column:1 },{ player:'X',row:0,column:2 },{ player:'O',row:2,column:2 }] }, expected: { results: [['played','X'],['played','O'],['played','X'],['played','O'],['won','X'],['finished']], board: [['X','X','X'],['O','O',null],[null,null,null]], next: null, winner: 'X', draw: false } },
  { label: 'Full board without victory is a draw', input: { moves: [{ player:'X',row:0,column:0 },{ player:'O',row:0,column:1 },{ player:'X',row:0,column:2 },{ player:'O',row:1,column:1 },{ player:'X',row:1,column:0 },{ player:'O',row:1,column:2 },{ player:'X',row:2,column:1 },{ player:'O',row:2,column:0 },{ player:'X',row:2,column:2 }] }, expected: { results: [['played','X'],['played','O'],['played','X'],['played','O'],['played','X'],['played','O'],['played','X'],['played','O'],['draw']], board: [['X','O','X'],['X','O','O'],['O','X','X']], next: null, winner: null, draw: true } },
];
const limiterExamples: ExampleCase[] = [
  { label: 'No active clients', input: { limit: 1, windowMs: 10, maxKeys: 2, requests: [] }, expected: { results: [], activeKeys: [] } },
  { label: 'Limit and exact reset boundary', input: { limit: 1, windowMs: 10, maxKeys: 2, requests: [{ key: 'a', at: 0 }, { key: 'a', at: 9 }, { key: 'a', at: 10 }] }, expected: { results: [[true,0,'allowed'],[false,1,'rate'],[true,0,'allowed']], activeKeys: ['a'] } },
  { label: 'Clients have independent quotas', input: { limit: 1, windowMs: 10, maxKeys: 2, requests: [{ key: 'a', at: 0 }, { key: 'b', at: 0 }] }, expected: { results: [[true,0,'allowed'],[true,0,'allowed']], activeKeys: ['a','b'] } },
  { label: 'Active client storage has a hard bound', input: { limit: 2, windowMs: 10, maxKeys: 1, requests: [{ key: 'a', at: 2 }, { key: 'b', at: 3 }] }, expected: { results: [[true,0,'allowed'],[false,7,'capacity']], activeKeys: ['a'] } },
  { label: 'Cleanup permits new clients at expiry', input: { limit: 1, windowMs: 10, maxKeys: 1, requests: [{ key: 'a', at: 0 }, { key: 'b', at: 10 }] }, expected: { results: [[true,0,'allowed'],[true,0,'allowed']], activeKeys: ['b'] } },
  { label: 'Property-looking client identifiers remain distinct', input: { limit: 1, windowMs: 10, maxKeys: 2, requests: [{ key: '__proto__', at: 1 }, { key: 'constructor', at: 2 }, { key: '__proto__', at: 3 }] }, expected: { results: [[true,0,'allowed'],[true,0,'allowed'],[false,7,'rate']], activeKeys: ['__proto__','constructor'] } },
];

export const lowLevelDesignSolutions: Record<string, WorkedSolution> = {
  'parcel-lockers': {
    code: parcelCode, examples: parcelExamples, lessonIds: ['introduction','object-modeling','collections'], sourceIds: ['js-classes','js-map','fowler-unit'],
    timeComplexity: 'For m lockers and q commands: O(q*m) scans plus initial and final comparison sorting of m records. Built-in sort has no specification-mandated complexity.',
    spaceComplexity: 'O(m + q), including copied locker state and returned results. No input locker or command is mutated.',
    sections: [
      { title: 'Reference scope and trace protocol', body: `This reference narrows the open design brief to one sequential facility. Input has lockers with unique ASCII identifier ids and integer sizes one through three, plus commands. There are at most thirty-two lockers and one hundred commands. Every command has a nondecreasing integer at between zero and ten thousand. Place also carries a package id, size, and integer expiresAt in the same range; pickup carries a code; tick carries no extra fields. Return one tagged result per command and an id-sorted occupancy view. The existing starter remains an open-ended object-design exercise, not an executable judge for this particular protocol.` },
      { title: 'Allocation and expiry belong to one owner', diagram: 'ParcelDepot owns Locker[]\n  apply(command, at) -> tagged result\n  Locker owns optional Parcel\n  Parcel = id + expiry + pickup code', body: `The depot owns all occupancy and applies expiry before interpreting each command. A parcel expires when its deadline is less than or equal to the supplied time, so a pickup at that instant is already missing. Selection uses the smallest compatible free compartment, breaking equal-size ties by ASCII identifier. An active package identity cannot occupy another compartment. Clear the complete parcel record on pickup or expiry, not just its package name. Keeping selection and mutation in one method preserves exclusive occupancy in this sequential model; it does not synchronize competing processes or persistent writers.` },
      { title: 'Receipts, rejection, and identifier boundaries', body: `Successful placement returns the compartment and a fresh deterministic pickup code. The increasing counter never reuses a code during a trace, even after occupancy expires. These predictable codes are teaching identifiers, not secure production credentials: an actual collection service needs appropriate unpredictable tokens, authorization, and expiry enforcement. A full or duplicate placement leaves active ownership unchanged, and an invalid expiry returns its own rejection. A missing or repeated pickup never releases another parcel. The model does not include durable operation receipts, so replaying a lost placement response is not automatically an idempotent service operation; that extension requires another explicit identity contract.` },
      { title: 'Verification and a justified extension', body: `The examples independently specify size ties, empty capacity, duplicate packages, inclusive expiry, repeated pickup, and code nonreuse. Replay them against the reference and compare the input before and after execution. The returned occupancy is a detached read model, not the mutable locker array. For larger facilities, maintain availability indexes only if searching becomes a demonstrated bottleneck, and account for index updates during every release. For persistent concurrent allocation, move the check-and-update invariant to an authoritative transaction or conditional write and test real competing writers. Neither private fields nor these sequential traces establish that stronger guarantee.` },
    ],
  },
  'parking-garage': {
    code: parkingCode, examples: parkingExamples, lessonIds: ['design-principles','interfaces','concurrency'], sourceIds: ['fowler-di','js-number','pg-locks'],
    timeComplexity: 'O(q*s) for q commands and s spaces, plus sorting snapshots under the runtime sorting model and dictionary operations for tickets.',
    spaceComplexity: 'O(s + q) copied spaces, retained tickets, and output. Rate and duration multiplication remains safe within the stated bounds.',
    sections: [
      { title: 'A bounded parking and pricing contract', body: `Input contains up to thirty-two uniquely identified spaces with sizes one through three, integer rateCents from zero to one thousand, and at most one hundred commands. Enter carries ticketId, size, and at; exit carries ticketId and at. Identifiers are ASCII strings of at most thirty-two characters. Times are nondecreasing integer milliseconds from zero through one million. Each started minute costs rateCents, while a zero-duration stay costs zero. Return a result for every command, an id-sorted occupancy snapshot, and sorted tickets with status and nullable charge. This sequential reference excludes payment providers and physical gate operation.` },
      { title: 'Separate session ownership from price selection', diagram: 'ParkingGarage owns Space[] and Ticket map\n  Ticket -> one Space + start time + lifecycle\n  Garage -> injected price(durationMs)\n  Closed Ticket retains integer-cent receipt', body: `The garage chooses the smallest compatible free space with an ASCII tie-breaker. A ticket owns its starting time and reference to that space until closure. Pricing is supplied as a pure collaborator, demonstrating dependency injection without a container. Compute the charge before changing closure state. The reference policy rounds the duration upward to complete started minutes and multiplies by an integer rate. A real policy failure must remain visible rather than silently close the session with zero charge. Keeping money in cents avoids decimal-unit confusion, but the design still needs explicit range bounds and a policy for taxes or other added charges.` },
      { title: 'Trace duplicate and competing ownership decisions', body: `A ticket identity is never reused within the trace. An accepted entry therefore creates one session; a second entry using that identity is duplicate even after closure. A rejected full entry does not create a ticket, allowing a later attempt when space becomes available. Exit of a missing ticket returns missing, while a second exit of a closed ticket returns already-closed without recalculating a charge. The occupancy owner prevents overlap only within sequential execution. Real simultaneous entries require a coordinated allocation boundary, and checkout involving a provider needs durable operation identity and reconciliation rather than an assumption that one callback means one charge.` },
      { title: 'Test pricing boundaries and adapter guarantees', body: `The fixtures cover exact sixty-thousand-millisecond boundaries, the first millisecond of the next billing minute, zero-duration stays, missing and duplicate tickets, and incompatible sizes. Expected integer-cent values are specified independently, not generated by the policy under test. Snapshots deliberately preserve closed receipts while clearing space ownership. That improves diagnostics and prevents identity reuse, but retained tickets add memory and need a production retention policy. Test alternative pricing policies through the same result contract; test database locking and provider behavior separately. A local policy test can establish arithmetic and lifecycle behavior without pretending to verify real transaction or payment semantics.` },
    ],
  },
  'board-game': {
    code: boardCode, examples: boardExamples, lessonIds: ['state-machines','testing-designs','object-modeling'], sourceIds: ['w3c-scxml','fowler-unit','js-classes'],
    timeComplexity: 'O(q) for q moves on this fixed 3x3 board. Each victory check examines a constant eight lines.',
    spaceComplexity: 'O(q) returned results plus constant board state. The input move history remains unchanged.',
    sections: [
      { title: 'Narrow the game before coding', body: `The original brief admits many grid games. This reference chooses a three-by-three placement game with players X and O, X moving first, and no removal or undo. Input contains at most thirty moves, each with player, row, and column; coordinates are integers zero through two and the player is X or O. Return tagged step results and a detached board, next player or null, winner or null, and draw flag. Invalid shape is outside this trace contract; an out-of-turn player or occupied cell is a validly formed command that the model rejects explicitly.` },
      { title: 'One owner guards turn and terminal state', diagram: 'GridGame owns 9 cells + next player\n  apply(move) checks terminal -> actor -> cell\n  accepted placement checks victory then draw\n  snapshot() returns copied rows', body: `Apply rejection checks in a documented order. Once the game is finished, every later move returns finished. Otherwise the player must match the current turn before the cell can be filled. A rejected command does not advance the turn or alter the board. After placement, check the eight winning lines before checking whether the board is full: a winning final placement must be a victory rather than a draw. Only a nonterminal successful placement switches the next player. This ordering is a concrete lifecycle rule that tests and alternative implementations must preserve, not an incidental arrangement of private helpers.` },
      { title: 'History and observations are different objects', body: `The supplied moves represent requested commands, including rejected ones. The result history explains which attempts changed the board. Replaying the same list from the initial state reproduces both accepted and rejected outcomes, making it a useful debugging artifact. A final board by itself cannot explain an attempted move after victory or an out-of-turn request. Expose a copied matrix rather than the mutable private cell array. If undo becomes a requirement, define whether it removes a requested command or the last accepted placement, and recompute terminal status accordingly. That is a new contract, not a free benefit of retaining an array.` },
      { title: 'Evidence and carefully scoped extensions', body: `Fixtures independently describe a diagonal win, a row win followed by a rejected extra move, an occupied cell, a wrong first actor, an empty game, and a full nonwinning board. Assert result order and all final fields, not just the winner. A parameterized board size changes the victory representation and complexity; a networked game adds authority, duplicate operation identities, and expected-turn versions. The local reference provides none of those infrastructure guarantees. Its purpose is a complete object-owned state history whose legal and illegal transitions are visible, giving a sound base for discussing what an extension would require.` },
    ],
  },
  'rate-limiter': {
    code: limiterCode, examples: limiterExamples, lessonIds: ['concurrency','collections','interfaces'], sourceIds: ['js-map','pg-locks','fowler-unit'],
    timeComplexity: 'O(q*k) cleanup scans for q requests and at most k active keys, plus dictionary operations and final key sorting.',
    spaceComplexity: 'O(k + q); maxKeys is a hard active-state bound, while results account for q output records.',
    sections: [
      { title: 'Declare the particular policy being modeled', body: `This premium original brief allows several limiter designs. The reference demonstrates only a fixed-window policy. Input supplies limit from one through five, windowMs from one through one hundred, maxKeys from one through thirty-two, and at most one hundred requests. Each request has an ASCII identifier key and nondecreasing integer at between zero and ten thousand. Windows align to multiples of windowMs, not to the first request. Return rows containing allowed, retry delay, and reason, followed by the sorted active-key view. A request exactly at a window boundary belongs to the next window.` },
      { title: 'Make admission and resource use explicit', diagram: 'FixedWindowPolicy owns bounded Client map\n  allow(key, at) -> [allowed, retryMs, reason]\n  expired windows removed before admission\n  maxKeys rejection differs from rate rejection', body: `Before evaluating a request, remove buckets whose window has ended. A new key gets a bucket only when active-key capacity permits it. Otherwise the capacity rejection reports the delay to the earliest active bucket expiry without claiming that this client exhausted its own quota. An existing bucket admits up to limit requests and returns a rate rejection for later requests in that window. Unlike expiry alone, maxKeys bounds simultaneous distinct-client state. The price of that hard bound is explicit admission rejection, which the caller must understand rather than treating every denial as a per-client rate violation.` },
      { title: 'Policy substitution does not create concurrency safety', body: `The allow contract can be implemented by another policy if its result and timing semantics are documented. Token buckets and sliding windows do not have the same burst behavior as fixed windows, so substitution may require callers to depend on a broader admission contract rather than identical traces. Time is supplied directly to make the reference deterministic. The operations execute sequentially in one JavaScript call; no mutex, database transaction, or distributed atomic update is present. A real concurrent implementation must coordinate count inspection and increment at the actual shared boundary and test overlapping callers. Naming a class Policy does not supply that mechanism.` },
      { title: 'Verify boundaries, cleanup, and retained state', body: `The fixtures distinguish exact reset timing, independent quotas, active-key capacity rejection, expiry cleanup, empty input, and identifiers such as constructor. Repeat identical traces and assert no caller-owned input changes. Capacity denial does not insert the rejected key or increment another bucket. The reference keeps no historic receipts, so it is not a deduplicating request ledger; a retried request is another admission attempt. Discuss clock regressions, process restart, and multi-process sharing before deployment. The stated valid domain uses nondecreasing times, and the narrow model should remain visibly distinct from a production limiter with durable or shared state.` },
    ],
  },
  'lld-inventory-ledger': {
    code: inventoryCode, examples: inventoryExamples, lessonIds: ['object-modeling','error-contracts','persistence','testing-designs'], sourceIds: ['pg-constraints','js-classes','js-map'],
    timeComplexity: 'q dictionary-based commands plus a sorted r-record snapshot; expected O(q + r*log(r)) under a hash-table and comparison-sort model, not a JavaScript specification guarantee.',
    spaceComplexity: 'O(r + q) retained reservation records and output, with r at most q. Input commands are not mutated.',
    sections: [
      { title: 'Represent inventory as a conserved quantity', body: `Input has integer units from zero through one thousand and at most two hundred commands. Reserve supplies an ASCII identifier id of one through thirty-two characters and quantity from one through one thousand. Release and commit supply an id. The output contains one tagged result per command and state with available, committed, and id-sorted reservation rows containing id, quantity, and status. The invariant is initial units equals available plus quantities currently reserved plus committed units. Released records remain in the identity ledger but contribute nothing to reserved quantity. This contract models one item pool, not a catalog of stock-keeping units.` },
      { title: 'Let the ledger own every mutation', diagram: 'InventoryLedger\n  owns available + committed\n  owns Map<reservationId, quantity/status>\n  reserve | release | commit\n  snapshot -> detached sorted rows', body: `Reserve first checks whether the identity already exists. The same quantity recovers a held reservation without decrementing availability again; a different quantity conflicts. A new request exceeding availability returns insufficient and does not allocate identity. Release restores units only from reserved state, while commit moves those units into committed accounting without restoring availability. Terminal records reject reopening under the same identity. Keep these decisions inside one method boundary so a caller cannot separately decrement stock and later forget to create its reservation. Private fields enforce local access ownership, while persistent concurrent implementations still need an authoritative coordination mechanism.` },
      { title: 'Be precise about idempotency and retention', body: `A repeated successful reserve with identical parameters has the same held response while the reservation remains active. Release and commit are state-effect idempotent: repeated terminal commands return closed rather than replaying the original response. This is deliberately not a full operation-receipt API. Rejected insufficient requests can be attempted again later under the same unused identity. Retaining terminal records prevents identity reuse and improves inspection, but it consumes memory proportional to accepted reservation identities. The finite trace bounds this model; a service needs a retention policy compatible with its retry and audit promises, not a claim that active stock alone bounds memory.` },
      { title: 'Verify a history and plan persistence', body: `The independently specified examples include empty input, zero capacity, repeated reserve, conflicting quantity, repeated release, missing identity, and commit followed by a rejected release. Check the conservation equation after every generated trace prefix, not only at the end. Compare with a simpler array-based model and assert input immutability. A persistent port must store the reservation and accounting change consistently and enforce identity uniqueness for all writers. Test real conflicting transactions and crash recovery separately. The browser reference proves a bounded sequential ledger contract; its invariants are useful design evidence but not a substitute for database or provider integration tests.` },
    ],
  },
  'lld-lru-cache': {
    code: cacheCode, examples: cacheExamples, lessonIds: ['collections','interfaces','testing-designs'], sourceIds: ['js-map','js-classes','fowler-unit'],
    timeComplexity: 'q dictionary operations and an O(c) snapshot for capacity c; expected O(q+c) under a hash-table model. JavaScript requires average sublinear Map access, not specified O(1) hashing.',
    spaceComplexity: 'O(c + q), including bounded entries and result history. No expiration or persistence metadata is retained.',
    sections: [
      { title: 'State the recency contract completely', body: `Input has integer capacity from zero through thirty-two and at most two hundred commands. Each command has put, get, or peek and an ASCII key of one through thirty-two characters. Put also includes an integer value from minus one thousand through one thousand. Output contains tagged results and entries ordered from least to most recent. Successful get touches recency, peek does not, and a missing lookup returns miss without changing order. Put acknowledges stored even when capacity zero immediately evicts the item. This local cache has no TTL, provider loading, asynchronous refresh, or distributed sharing.` },
      { title: 'Encapsulate an ordered key collection', diagram: 'LruCache owns capacity and ordered Map\n  put -> replace and make most recent\n  get -> tagged hit and refresh order\n  peek -> tagged hit without touching\n  snapshot -> oldest-to-newest pairs', body: `Map insertion order supplies the ordering mechanism. Remove and reinsert an existing key to make it most recent; merely overwriting its value would preserve its earlier position. After put, evict the oldest key when capacity is exceeded. Check membership separately from retrieving the value so stored zero is not treated as a miss. A key that looks like an object property is still an ordinary Map key. Returning detached entry pairs keeps clients from altering the private collection. This representation is compact for the bounded exercise without requiring a custom linked-list implementation and its additional unlinking invariants.` },
      { title: 'Separate a policy change from an implementation change', body: `Replacing Map recency with a linked list can preserve the same public trace behavior. Adding expiration cannot: get and peek may now reject an entry based on time, and put needs a lifetime contract. Request coalescing adds another asynchronous boundary, while tenant-aware keys change identity. Discuss those extensions individually rather than promising a production cache because eviction works. The complexity model must also be honest: Map operations are not specified as hash-table constant time by JavaScript. Use explicit dictionary-operation counts or qualify an expected hash implementation. Returned result history contributes memory even though active entry count is capped.` },
      { title: 'Compare against a simpler independent model', body: `The six example traces isolate get-based refresh, non-touching peek, replacement, zero capacity, missing keys, zero values, and special identifiers. An independent array model can scan for a key, remove it, and append a replacement to compute expected order for bounded random traces. That model is slower but easier to inspect, making it a useful oracle instead of a duplicate of the Map implementation. Check every result and final ordering, input immutability, and repeated calls. Passing these checks establishes the specified sequential eviction behavior, not freshness, backend reliability, concurrency, or optimal performance for an unbounded deployment.` },
    ],
  },
  'lld-workflow-engine': {
    code: workflowCode, examples: workflowExamples, lessonIds: ['state-machines','concurrency','error-contracts'], sourceIds: ['w3c-scxml','pg-isolation','js-map'],
    timeComplexity: 'O(q) transition-table work plus q dictionary receipt operations; expected linear total under a hash-table model.',
    spaceComplexity: 'O(q) cached receipts and returned results. The finite trace does not implement production receipt expiry.',
    sections: [
      { title: 'Define the sequential approval protocol', body: `Input contains at most two hundred commands with an ASCII id of one through thirty-two characters, event submit, approve, or cancel, and integer expectedVersion from zero through two hundred. Start in draft at version zero. Draft allows submit or cancel; submitted allows approve or cancel; approved and cancelled are terminal. Return one tagged result row containing outcome, state, and version for each command, plus the current final state and version. The reference caches both successful and rejected command receipts. It is an educational transition-table model, not a full W3C state-chart interpreter or a durable multi-writer workflow service.` },
      { title: 'Bind identity before examining current state', diagram: 'ApprovalWorkflow owns state + version + receipts\n  prior id? compare event and expected version\n  else compare current version, then legal edge\n  accepted edge increments version exactly once\n  receipt stores the historical response', body: `A repeated command identity with identical event and expected version returns its original receipt, even if another command has since changed the workflow. Reusing that identity with different parameters returns identity-conflict against the current state and does not overwrite the receipt. For a new identity, reject a stale expected version before checking the transition edge. An accepted transition advances version once; stale or illegal commands leave it unchanged. Store a copy of the response so later callers cannot mutate the cached receipt. This evaluation order is part of the public protocol, not merely a private implementation choice.` },
      { title: 'Distinguish replay from a present-state observation', body: `Suppose submit accepted version one, then cancel accepted version two. Retrying the original submit returns the historical submitted/version-one receipt, while the final snapshot still reports cancelled/version-two. That apparent difference is intentional: a receipt answers what happened to a command, and a snapshot answers what is true now. Do not replace cached responses with the current state or execute their effects again. Persisting this contract across crashes requires storing both transition and receipt consistently. A version parameter in a sequential JavaScript function is only a simulation of optimistic checks, not an atomic compare-and-swap across real database transactions.` },
      { title: 'Test illegal, stale, repeated, and conflicting histories', body: `The examples independently cover initial state, approval before submission, a valid approval chain, a stale write, historical replay after cancellation, and identity reuse with changed parameters. Generate more traces against a compact declarative transition model and verify versions advance only for newly accepted identities. Include rejected receipt replay after later state changes, because rejection caching is also contractual here. All traces leave input commands unchanged. Explain the limits: receipts remain for the bounded run, external effects are absent, and no concurrent execution is tested. A persistent implementation needs retention, authorization, transactional coordination, and actual overlapping-writer evidence before making stronger guarantees.` },
    ],
  },
  'lld-file-catalog': {
    code: catalogCode, examples: catalogExamples, lessonIds: ['patterns','error-contracts','design-walkthrough'], sourceIds: ['fowler-tell','js-map','fowler-unit'],
    timeComplexity: 'Up to O(q*N*L) scanning and path work for q commands, N nodes, and maximum path length L, plus listing/snapshot sorting under the runtime model.',
    spaceComplexity: 'O(N*L + stored content + output). The index contains at most one new node per successful creation command.',
    sections: [
      { title: 'A catalog is not an operating-system filesystem', body: `Input contains at most two hundred commands using mkdir, write, read, list, or remove. Paths are root or absolute slash-separated ASCII segments matching letters, digits, underscore, and hyphen, with one through sixteen characters per segment and maximum path length two hundred fifty-six. Repeated separators, dot segments, and trailing separators are outside the valid domain. Write includes an ASCII content string of at most one hundred twenty-eight characters. Root exists initially. Output contains tagged step results and a sorted path/kind snapshot. Permissions, symbolic links, disk access, recursive deletion, and streaming are deliberately absent.` },
      { title: 'One node index enforces kind and parent rules', diagram: 'FileCatalog owns Map<absolute path, Node>\n  Directory node: kind only\n  File node: kind + content\n  parent must exist and be a directory\n  observations return strings and copied name lists', body: `Creating a node requires an existing directory parent; the catalog never creates missing ancestors implicitly. A file cannot become a parent or be listed as a directory. Writing replaces file content but cannot replace a directory. Directory creation rejects an existing path. These checks happen before inserting a node, preventing partial hierarchy changes. Parent lookup uses the supplied canonical path contract, not platform-dependent filename normalization. Listing scans for direct children only and orders names by ASCII code-unit order. The flat index is intentionally simple; a child index would add update invariants that are not needed for the bounded trace.` },
      { title: 'Reject destructive ambiguity explicitly', body: `Remove protects root and rejects a nonempty directory rather than recursively erasing descendants. A missing target, wrong kind, missing parent, and parent that is a file have distinct outcomes. Reading an empty file returns a content result with an empty string, not a not-found fallback. Deleting a file releases its index entry and permits later recreation at that path. These rules make successful and rejected histories inspectable. They do not supply operating-system safety for arbitrary paths: an actual storage adapter must enforce its own root confinement, authorization, limits, and provider error behavior at the I/O boundary.` },
      { title: 'Verify hierarchy histories and scope extensions', body: `The examples independently cover root-only state, missing parents, replacement and readback, direct-child ordering, nonrecursive deletion, protected root, and property-looking names. Compare result tags and the entire final path view, not merely node count. Input commands and content remain caller-owned. An independent nested-tree model can challenge the flat-index implementation on small traces. Adding recursive deletion changes both the contract and failure boundary; adding persistence introduces transaction and crash-recovery evidence. Keep those extensions separate from this pure JavaScript catalog, whose purpose is an explicit object-owned hierarchy that can be executed and explained without touching a real filesystem.` },
    ],
  },
};

const starter = 'function solve(input) {\n  throw new Error("Implement the stated command contract.");\n}';
export const additionalLowLevelDesignProblems: Problem[] = [
  { id: 'lld-inventory-ledger', track: 'low-level-design', title: 'A reservation inventory ledger', difficulty: 'Medium',
    description: 'Implement a sequential ledger for a single inventory pool. Input: {units, commands}; units is an integer 0..1000, commands has 0..200 reserve/release/commit operations, ids are ASCII identifiers of length 1..32, and reserve quantities are integers 1..1000. Return {results, state} using the exact reference contract and examples.',
    requirements: ['Conserve available, reserved, and committed units.', 'Repeat an active reservation without double consumption; reject changed quantity.', 'Release or commit a held reservation exactly once.', 'Keep terminal identity records and return explicit rejection tags.', 'Return sorted detached state without mutating input.'],
    keywords: [['invariant','conservation'],['identity','idempotent'],['state','terminal'],['map','encapsulation'],['test','rejection']], starter, testCases: inventoryExamples },
  { id: 'lld-lru-cache', track: 'low-level-design', title: 'A bounded cache with observable recency', difficulty: 'Easy',
    description: 'Implement solve({capacity, commands}) for capacity 0..32 and up to 200 put/get/peek commands. Keys are ASCII identifiers of length 1..32; put values are integers -1000..1000. Return {results, entries}, where entries are [key,value] pairs from least to most recent. No TTL or asynchronous loading is included.',
    requirements: ['Put replaces a key and makes it most recent.', 'Get refreshes a hit; peek observes without touching.', 'Return tagged hit/miss/stored results, preserving zero values.', 'Evict the least recent key and retain none at capacity zero.', 'Preserve input and expose detached ordered entries.'],
    keywords: [['recency','least'],['capacity','evict'],['map','order'],['hit','miss'],['test','immutable']], starter, testCases: cacheExamples },
  { id: 'lld-workflow-engine', track: 'low-level-design', title: 'Approval transitions with versioned receipts', difficulty: 'Hard',
    description: 'Implement solve({commands}) for up to 200 sequential commands with ASCII ids of length 1..32, event submit/approve/cancel, and integer expectedVersion 0..200. Start draft/version 0. Return {results,state,version}; each result is [outcome,state,version]. Exact transition and receipt semantics are documented in the worked reference.',
    requirements: ['Check bound command identity before evaluating current state.', 'Reject stale versions before illegal edges without mutation.', 'Advance version only on accepted transitions.', 'Replay the historical receipt for identical retries, including rejected commands.', 'Reject changed parameters under a used identity; never mutate input.'],
    keywords: [['version','stale'],['receipt','idempotent'],['transition','state'],['conflict','identity'],['test','sequential']], starter, testCases: workflowExamples },
  { id: 'lld-file-catalog', track: 'low-level-design', title: 'An in-memory directory and file catalog', difficulty: 'Medium',
    description: 'Implement solve({commands}) for up to 200 mkdir/write/read/list/remove commands. Canonical paths are root or absolute ASCII letter/digit/underscore/hyphen segments, 1..16 characters each and at most 256 characters total, without dot segments or trailing slashes. Write content is ASCII, length 0..128. Return {results,paths}; this model performs no filesystem I/O.',
    requirements: ['Require an existing directory parent; never create it implicitly.', 'Distinguish file and directory operations and explicit error tags.', 'List direct children in ASCII order and allow file replacement.', 'Protect root and reject nonrecursive removal of nonempty directories.', 'Return sorted path/kind rows and preserve all input.'],
    keywords: [['composite','kind'],['parent','directory'],['error','rejection'],['root','nonrecursive'],['test','path']], starter, testCases: catalogExamples },
];
