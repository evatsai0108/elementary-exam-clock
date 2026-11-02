from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent
with ZipFile(root / 'offline-exam-clock.zip', 'w', ZIP_DEFLATED) as archive:
    for filename in ['index.html', 'style.css', 'readability.css', 'app.js', 'clock.js', 'favicon.svg']:
        archive.write(root / filename, filename)
    archive.write(root / 'README.md', 'README.md')
print('Offline package created: offline-exam-clock.zip')
