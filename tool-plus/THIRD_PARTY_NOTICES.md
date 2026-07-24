# Third-party notices

Tool Plus bundles the following command-line components in the Windows installer:

- pdfcpu — Apache License 2.0 — https://github.com/pdfcpu/pdfcpu
- yt-dlp — The Unlicense — https://github.com/yt-dlp/yt-dlp
- ExifTool — Perl Artistic License or GNU General Public License — https://exiftool.org/
- FFmpeg — GNU General Public License v3 build — https://ffmpeg.org/

Tool Plus also bundles the FlowCanvas 0.2.0 browser IIFE and its compiled UI runtime:

- React 19.2.7 — MIT License — https://react.dev/
- React DOM 19.2.7 — MIT License — https://react.dev/
- @xyflow/react 12.11.2 — MIT License — https://reactflow.dev/
- lucide-react 1.24.0 — ISC License — https://lucide.dev/

FlowCanvas is maintained with this project and is embedded as a local browser asset.
The standalone `@flowcanvas/sdk` 0.2.0 package declares the MIT License and includes a
root LICENSE file. This notice does not change the upstream licenses of the compiled
dependencies listed above.

The bundled ExifTool Windows distribution also contains its own license files under
`resources/tools/exiftool/exiftool_files` after installation. Electron, Go modules,
Python bridge dependencies, and their transitive packages retain their respective
upstream licenses.

The bundled FFmpeg executable is the gyan.dev Windows x64 essentials GPL build of FFmpeg 8.1.
Its GPLv3 license text and redistribution/source information are installed under
`resources/tools/ffmpeg`.
