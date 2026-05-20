package analyzer

import "go/types"

const RelSatisfies = "Satisfies"

// findInterfaceImpls emits one Satisfies relation for each (concrete type, interface)
// pair where the concrete type — by value or by pointer — satisfies the interface's
// method set. Empty interfaces are skipped (they match everything) and self-loops
// are skipped (every interface trivially satisfies itself).
//
// Inter-interface satisfaction (embedded interfaces) is also captured: if
// interface A embeds B, A satisfies B and we emit A → B.
//
// Inputs come from the entity-extraction pass: `entities` is the canonical list
// of our entities, `defIDs` is the (types.Object → entity ID) map we built
// while walking pkg.Syntax. We rely on go/types having resolved every method
// set already, so this pass is O(interfaces × candidates) with constant-time
// Implements checks.
func findInterfaceImpls(entities []Entity, defIDs map[types.Object]string) []Relation {
	entityKind := make(map[string]string, len(entities))
	for _, e := range entities {
		entityKind[e.ID] = e.Kind
	}

	type tobj struct {
		obj types.Object
		id  string
	}
	var ifaces []tobj
	for obj, id := range defIDs {
		if entityKind[id] == KindInterface {
			ifaces = append(ifaces, tobj{obj, id})
		}
	}
	if len(ifaces) == 0 {
		return nil
	}

	var rels []Relation
	for _, i := range ifaces {
		ifaceNamed, ok := i.obj.Type().(*types.Named)
		if !ok {
			continue
		}
		ifaceType, ok := ifaceNamed.Underlying().(*types.Interface)
		if !ok {
			continue
		}
		if ifaceType.NumMethods() == 0 {
			// any T satisfies the empty interface — would just create noise.
			continue
		}

		for obj, id := range defIDs {
			if id == i.id {
				continue
			}
			switch entityKind[id] {
			case KindStruct, KindType, KindInterface:
				// candidate
			default:
				continue
			}

			named, ok := obj.Type().(*types.Named)
			if !ok {
				continue
			}
			if types.Implements(named, ifaceType) ||
				types.Implements(types.NewPointer(named), ifaceType) {
				rels = append(rels, Relation{
					FromID: id,
					ToID:   i.id,
					Kind:   RelSatisfies,
				})
			}
		}
	}
	return rels
}
