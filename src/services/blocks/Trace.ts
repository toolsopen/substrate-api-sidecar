import { ApiPromise } from '@polkadot/api';
import { AccountInfo, Address } from '@polkadot/types/interfaces';

import { KeyInfo, TraceBlock, TraceEvent, TraceSpan } from './types';

type SpanWithName = TraceSpan & { keyName: KeyInfo };

type EventWithName = TraceEvent & { keyName: KeyInfo };

type EventWithParent = EventWithName & { parentName: string[] };

type EventWithAccountInfo = EventWithParent & {
	accountInfo: AccountInfo;
	address: Address;
};

export interface TraceTestOne {
	onlySystemAccount: EventWithAccountInfo[];
	// Spans grouped by Id
	spansById: Map<number, SpanWithName[]>;
	// Events grouped by parent_id
	eventsByParent: Map<number, EventWithParent[]>;
}

const EMPTY_KEY_INFO = {
	name: 'cannot-find-key',
	key: '',
};

export class Trace {
	/**
	 * Known storage keys.
	 */
	private keyNames;
	/**
	 * Temp, this should get passed in as a registry from something that has the
	 * correct registry of the type at that block height.
	 */
	private registry;

	constructor(private api: ApiPromise, private traceBlock: TraceBlock) {
		this.keyNames = this.getKeyNames();
		this.registry = this.api.registry;
	}

	testOne(): TraceTestOne {
		return {
			onlySystemAccount: this.systemAccountEvents(),
			spansById: this.spansById(),
			eventsByParent: this.eventsByParentId(),
		};
	}

	private getKeyNames() {
		const result = {};
		Object.keys(this.api.query).forEach((mod) => {
			Object.keys(this.api.query[mod]).forEach((item) => {
				const queryObj = this.api.query[mod][item];
				let key;
				try {
					// Slivr off '0x' prefix
					key = queryObj.key().slice(2);
				} catch {
					key = queryObj.keyPrefix().slice(2);
				}

				result[key] = {
					name: `${mod}::${item}`,
					key,
				};
			});
		});

		const wellKnownKeys = {
			'3a636f6465': {
				name: ':code',
				key: '0x3a636f6465',
			},
			'3a686561707061676573': {
				name: ':heappages',
				key: '0x3a686561707061676573',
			},
			'3a65787472696e7369635f696e646578': {
				name: ':extrinsic_index',
				key: '0x3a65787472696e7369635f696e646578',
			},
			'3a6368616e6765735f74726965': {
				name: ':changes_trie',
				key: '0x3a6368616e6765735f74726965',
			},
			'3a6368696c645f73746f726167653a': {
				name: ':child_storage:',
				key: '0x3a6368696c645f73746f726167653a',
			},
		};

		return { ...result, ...wellKnownKeys };
	}

	private spansWithName(): SpanWithName[] {
		return this.traceBlock.spans.map((s) => {
			const { key } = s.values.string_values;
			const keyName =
				(key && (this.keyNames[key?.slice(0, 64)] as KeyInfo)) ||
				EMPTY_KEY_INFO;

			return { ...s, keyName };
		});
	}

	private spansById(): Map<number, SpanWithName[]> {
		return this.spansWithName().reduce((acc, cur) => {
			if (!acc.has(cur.id)) {
				acc.set(cur.id, []);
			}

			acc.get(cur.id)?.push(cur);

			return acc;
		}, new Map<number, SpanWithName[]>());
	}

	private eventsWithName(): EventWithParent[] {
		const spansById = this.spansById();
		return this.traceBlock.events
			.map((e) => {
				const { key } = e.values.string_values;
				const keyPrefix = key?.slice(0, 64);

				const keyName =
					(keyPrefix && (this.keyNames[keyPrefix] as KeyInfo)) ||
					EMPTY_KEY_INFO;

				return { ...e, keyName };
			})
			.map((e) => {
				const parentName: string[] =
					spansById.get(e.parent_id)?.map((p) => {
						return `${p?.name}::${p?.target}`;
					}) || [];

				return { ...e, parentName };
			});
	}

	private eventsByParentId(): Map<number, EventWithParent[]> {
		return this.eventsWithName().reduce((acc, cur) => {
			if (!acc.has(cur.parent_id)) {
				acc.set(cur.parent_id, []);
			}

			acc.get(cur.parent_id)?.push(cur);

			return acc;
		}, new Map<number, EventWithParent[]>());
	}

	private systemAccountEvents(): EventWithAccountInfo[] {
		return this.eventsWithName()
			.filter((e) => e.keyName?.name == 'system::account')
			.map((e) => {
				// key = h(system) + h(account) + h(address) + address
				// Remove the storage key + account hash
				const addressRaw = e.values.string_values.key?.slice(96);

				const address = this.registry.createType(
					'Address',
					`0x${addressRaw}`
				);
				const accountInfoEncoded = e?.values?.string_values
					?.result as string;

				console.log(accountInfoEncoded?.slice(0, 5));
				let accountInfo;
				if (accountInfoEncoded?.slice(0, 5) === 'Some(') {
					const len = accountInfoEncoded.length;
					const scale = accountInfoEncoded.slice(5, len - 1);
					accountInfo = this.registry.createType(
						'AccountInfo',
						`0x${scale}`
					);
				} else {
					accountInfo = this.registry.createType('AccountInfo');
				}

				return { ...e, accountInfo, address };
			});
	}
}