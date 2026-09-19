#!/usr/bin/env python3
import json, os, pathlib, re, sys
root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
env_file = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else root / '.env')
out_file = pathlib.Path(sys.argv[3] if len(sys.argv) > 3 else root / 'runtime/modules.json')

def parse_env(path):
    data = {}
    if not path.exists(): return data
    for raw in path.read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line: continue
        k,v = line.split('=',1)
        v=v.strip()
        if len(v)>=2 and v[0]==v[-1] and v[0] in "'\"": v=v[1:-1]
        data[k.strip()] = v
    return data

env = parse_env(env_file)
items=[]
mods=root/'modules'
if mods.exists():
    for d in sorted(mods.iterdir()):
        if not d.is_dir() or d.name.startswith('_'): continue
        meta=parse_env(d/'module.env')
        if not meta: continue
        mid=meta.get('EMS_MODULE_ID', d.name)
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]*', mid):
            raise SystemExit(f'Invalid module id: {mid}')
        flag=meta.get('EMS_MODULE_ENV_FLAG', 'EMS_MODULE_'+mid.upper().replace('-','_')+'_ENABLED')
        default=meta.get('EMS_MODULE_DEFAULT','OFF').upper() in {'ON','TRUE','YES','1'}
        enabled=env.get(flag, 'true' if default else 'false').lower() in {'1','true','yes','on'}
        items.append({
            'id': mid,
            'name': meta.get('EMS_MODULE_NAME', mid),
            'description': meta.get('EMS_MODULE_DESCRIPTION',''),
            'icon': meta.get('EMS_MODULE_ICON','▦'),
            'enabled': enabled,
            'upstream': meta.get('EMS_MODULE_UPSTREAM',''),
        })
out_file.parent.mkdir(parents=True, exist_ok=True)
out_file.write_text(json.dumps(items, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
