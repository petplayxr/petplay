import * as zip from '@quentinadam/zip';
import { walk } from "https://deno.land/std/fs/mod.ts";
import { resolve, relative } from "https://deno.land/std/path/mod.ts";

async function createReleasePackage() {
    const files = [];

    // Add PetPlay.exe
    files.push({
        name: 'PetPlay.exe',
        data: await Deno.readFile('./PetPlay.exe')
    });

    // Add openvr_api.dll
    files.push({
        name: 'openvr_api.dll',
        data: await Deno.readFile('./openvr_api.dll')
    });

    // Add resources folder and its contents
    for await (const entry of walk("./resources")) {
        if (entry.isFile) {
            const relativePath = relative('.', entry.path);
            files.push({
                name: relativePath,
                data: await Deno.readFile(entry.path)
            });
        }
    }

    // Add Hyperswarm/main.exe
    files.push({
        name: 'Hyperswarm/main.exe',
        data: await Deno.readFile('./Hyperswarm/main.exe')
    });

    // Create the zip
    const buffer = await zip.create(files);

    // Write the zip file
    await Deno.writeFile('PetPlay-release.zip', buffer);

    console.log('Release package created: PetPlay-release.zip');
}

await createReleasePackage();