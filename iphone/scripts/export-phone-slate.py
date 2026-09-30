#!/usr/bin/env python3
"""Read explicitly selected QiMovi desktop workspaces into a phone planning snapshot.

Read-only SQLite access. Never exports credentials, screenplay paragraphs or database files.
Personal snapshot and thumbnail output must stay outside public repositories.
"""
import argparse, datetime, hashlib, json, pathlib, sqlite3

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--workspace', action='append', required=True, type=pathlib.Path)
p.add_argument('--output', required=True, type=pathlib.Path)
p.add_argument('--thumbnails', type=pathlib.Path)
a=p.parse_args()
projects=[]; image_count=0
for workspace in a.workspace:
    db=sqlite3.connect(f'file:{workspace.resolve()}/workspace.sqlite?mode=ro', uri=True)
    db.execute('BEGIN')
    raw=db.execute("SELECT value FROM metadata WHERE key='project'").fetchone()[0]
    project=json.loads(raw)
    cells=[]
    for rid,d,h in db.execute("SELECT r.id,r.data,r.sha256 FROM records r JOIN (SELECT id,MAX(version) v FROM records GROUP BY id) m ON r.id=m.id AND r.version=m.v WHERE r.kind='storyboard-cell'"):
        cell=json.loads(d)
        if cell.get('sourceHash')==project.get('sourceHash'): cells.append((rid,cell,h))
    shots=[]
    for scene in project.get('scenes',[]):
        for shot in scene.get('shots',[]):
            item=dict(id=shot['id'], sceneId=scene['id'], sceneHeading=scene['heading'],title=shot.get('label',shot['id'])+' · '+shot.get('description','')[:250],order=len(shots)+1,framing='Unspecified',movement='Unspecified',durationSeconds=(shot['plannedDurationMs']/1000 if shot.get('plannedDurationMs') else None),notes=shot.get('description',''),status='planned',sourceHash=project.get('sourceHash'),sourceRecordHash=shot.get('shotHash'))
            matching=[x for x in cells if x[1].get('shotId')==shot['id'] and x[1].get('crop') is None and x[1].get('imageHash')]
            matching.sort(key=lambda x: (x[1].get('role')!='START',x[0]))
            if matching and a.thumbnails and image_count<12:
                rid,cell,h=matching[0]; imagehash=cell['imageHash']
                if len(imagehash)==64 and all(c in '0123456789abcdef' for c in imagehash):
                    source=workspace/'blobs'/imagehash
                    if source.is_file() and not source.is_symlink():
                        image=source.read_bytes()
                        if hashlib.sha256(image).hexdigest()==imagehash:
                            ext='png' if image.startswith(b'\x89PNG') else 'jpg' if image.startswith(b'\xff\xd8\xff') else None
                            if ext:
                                a.thumbnails.mkdir(parents=True,exist_ok=True)
                                filename=f'{imagehash}.{ext}'
                                (a.thumbnails/filename).write_bytes(image)
                                item.update(thumbnail=f'Thumbnails/{filename}',storyboardRecordID=rid,storyboardImageHash=imagehash,storyboardReview=cell.get('review','UNKNOWN'))
                                image_count+=1
            shots.append(item)
    projects.append(dict(id=project['id'],title=project['title'],phase='Unassigned',synopsis=None,sourceHash=project.get('sourceHash'),shots=shots,tasks=[],sourceStatus=project.get('sourceStatus','UNKNOWN'),phaseOrigin='NOT_ESTABLISHED',sourceRecordHash=hashlib.sha256(raw.encode()).hexdigest()))
    db.rollback(); db.close()
package=dict(schemaVersion='qimovi-phone-production/v1',exportedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z'),origin='QiMovi desktop read-only workspace snapshot',projects=projects)
a.output.parent.mkdir(parents=True,exist_ok=True)
a.output.write_text(json.dumps(package,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(dict(projects=len(projects),shots=sum(len(x['shots']) for x in projects),thumbnails=image_count,output=str(a.output))))
