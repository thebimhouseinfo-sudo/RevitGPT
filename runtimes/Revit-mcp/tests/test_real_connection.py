"""Test script to connect to real Revit, place an air grille, and tag it."""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from connection.bridge import (
    health_check,
    get_active_document,
    get_levels,
    get_views,
    get_families,
    get_family_types,
    place_family_instance,
    create_tag,
    get_element,
)


def main():
    print("=" * 60)
    print("REVIT MCP - REAL CONNECTION TEST")
    print("=" * 60)
    
    print("\n1. Health check...")
    health = health_check()
    print(f"   Available: {health['available']}")
    if not health['available']:
        print(f"   Error: {health.get('error', 'Unknown')}")
        print("\n   Make sure the Revit bridge is running:")
        print("   - Open Revit 2024")
        print("   - Run 'Revit MCP Bridge' from pyRevit ribbon")
        print("   - Bridge should be at http://127.0.0.1:8765")
        return False
    
    print(f"   Bridge version: {health['bridge'].get('version', 'unknown')}")
    
    print("\n2. Get active document...")
    doc = get_active_document()
    print(f"   Title: {doc.get('title', 'N/A')}")
    print(f"   Path: {doc.get('path', 'N/A')}")
    print(f"   Revit version: {doc.get('revit_version', 'N/A')}")
    print(f"   Document ID: {doc.get('id', 'N/A')}")
    
    print("\n3. Get levels...")
    levels = get_levels()
    if not levels:
        print("   No levels found!")
        return False
    print(f"   Found {len(levels)} level(s):")
    for level in levels[:5]:
        print(f"   - {level['name']} (ID: {level['id']}, Elevation: {level['elevation']}ft)")
    first_level = levels[0]
    
    print("\n4. Get views...")
    views = get_views()
    if not views:
        print("   No views found!")
        return False
    print(f"   Found {len(views)} view(s):")
    floor_plans = [v for v in views if v.get('view_type') == 'FloorPlan']
    if floor_plans:
        print(f"   Floor plans: {len(floor_plans)}")
        for v in floor_plans[:3]:
            print(f"   - {v['name']} (ID: {v['id']})")
    
    print("\n5. Search for air grille/diffuser families...")
    families = get_families(category="Ducts")
    print(f"   Found {len(families)} duct-related families")
    
    grille_keywords = ["grille", "diffuser", "register", "supply", "return", "exhaust", "air"]
    grille_families = []
    for fam in families:
        name_lower = fam.get('name', '').lower()
        if any(kw in name_lower for kw in grille_keywords):
            grille_families.append(fam)
            print(f"   - {fam['name']} (ID: {fam['id']})")
    
    if not grille_families:
        print("   No grille/diffuser families found in 'Ducts' category.")
        print("   Trying 'Mechanical Equipment' category...")
        families = get_families(category="Mechanical Equipment")
        for fam in families:
            name_lower = fam.get('name', '').lower()
            if any(kw in name_lower for kw in grille_keywords):
                grille_families.append(fam)
                print(f"   - {fam['name']} (ID: {fam['id']})")
    
    if not grille_families:
        print("\n   No suitable grille/diffuser families found.")
        print("   Listing all duct families:")
        for fam in families[:10]:
            print(f"   - {fam['name']}")
        return False
    
    selected_family = grille_families[0]
    print(f"\n   Selected: {selected_family['name']}")
    
    print("\n6. Get family types...")
    types = get_family_types(family=selected_family['name'])
    if not types:
        print(f"   No types found for {selected_family['name']}")
        return False
    print(f"   Found {len(types)} type(s):")
    for t in types[:5]:
        print(f"   - {t['type']} (ID: {t['id']})")
    selected_type = types[0]
    print(f"\n   Selected type: {selected_type['type']}")
    
    print("\n7. Place family instance...")
    print("   Placing at coordinates: x=0, y=0, z=10 (on first level)")
    try:
        placed = place_family_instance(
            family=selected_family['name'],
            type=selected_type['type'],
            x=0,
            y=0,
            z=10,
            level_id=first_level['id'],
            rotation=0,
        )
        print(f"   SUCCESS! Placed element ID: {placed.get('id')}")
        print(f"   Category: {placed.get('category')}")
        print(f"   Family: {placed.get('family')}")
        print(f"   Type: {placed.get('type')}")
        if placed.get('location'):
            loc = placed['location']
            print(f"   Location: x={loc.get('x')}, y={loc.get('y')}, z={loc.get('z')}")
    except Exception as e:
        print(f"   ERROR placing family: {e}")
        return False
    
    element_id = placed.get('id')
    if not element_id:
        print("   No element ID returned!")
        return False
    
    print("\n8. Create tag for the placed element...")
    print("   Tagging at position: x=5, y=5, z=10")
    try:
        tag = create_tag(
            view_id=floor_plans[0]['id'] if floor_plans else views[0]['id'],
            element_id=element_id,
            x=5,
            y=5,
            z=10,
            has_leader=True,
        )
        print(f"   SUCCESS! Tag ID: {tag.get('id')}")
        print(f"   Tagged element: {tag.get('tagged_element_id')}")
        print(f"   Tag head: {tag.get('tag_head_family')} - {tag.get('tag_head_type')}")
    except Exception as e:
        print(f"   ERROR creating tag: {e}")
        return False
    
    print("\n9. Verify placed element...")
    try:
        elem = get_element(element_id)
        print(f"   Element ID: {elem.get('id')}")
        print(f"   Category: {elem.get('category')}")
        print(f"   Family: {elem.get('family')}")
        print(f"   Type: {elem.get('type')}")
    except Exception as e:
        print(f"   ERROR getting element: {e}")
    
    print("\n" + "=" * 60)
    print("TEST COMPLETED SUCCESSFULLY!")
    print("=" * 60)
    print(f"\nSummary:")
    print(f"  - Document: {doc.get('title')}")
    print(f"  - Placed: {selected_family['name']} - {selected_type['type']}")
    print(f"  - Element ID: {element_id}")
    print(f"  - Tag ID: {tag.get('id')}")
    print(f"\nCheck Revit to see the placed grille and tag!")
    
    return True


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
