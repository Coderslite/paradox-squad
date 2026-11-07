# Realistic characters (Mixamo)

`CharacterView` shows a realistic Mixamo human when character assets are present, and the
procedural "robot" body otherwise. Aim, recoil, hit reactions, two-hand weapon IK, reload hand
motion, ally/enemy rim and the dissolve death effect work on both.

## Adding characters

1. From mixamo.com download:
   - **Characters** → `apps/web/public/assets/raw/characters/` (FBX Binary, T-pose)
   - **Animations** → `apps/web/public/assets/raw/animations/` (FBX Binary, *Without Skin*, *In Place* ticked)
2. Run `pnpm --filter @paradox/web characters:manifest`. It prints how each file was matched.
3. Reload the game.

File names are matched by keyword (`Rifle Idle`, `Rifle Run`, `Strafe Left`, `Walking Backwards`,
`Sprint`, `Crouch Idle`, `Crouch Walk`, `Jump`, `Falling Idle`, `Landing`, `Dying`...). Several
`Dying` files become random death variations. A multi-clip GLB can be referenced as `pack.glb#clipName`.

## Files

- `assets.ts`: loading (FBX/GLB), bone-name normalisation, 1.8 m scaling, clip clean-up, hips retargeting
- `HumanoidBody.ts`: motion-clip blending (idle / walk / run / sprint / strafe / back / crouch / jump / fall / land / death) and generic arm IK
- `humanoidMaterial.ts`: rim, team sheen and dissolve on the realistic materials
- `manifest.ts` + `apps/web/scripts/build-character-manifest.mjs`: the asset list

Each remote player keeps the same character (`setCharacterKey(id)`); others are dealt round-robin.
Distant characters animate at 30/15 Hz to keep 8 people at 60 FPS on an M1.

## Later: smaller downloads

Once the look is right, convert the FBX files to compressed GLB (gltf-transform with Meshopt and
KTX2 textures) and run the manifest script again; the loader handles `.glb` the same way.
