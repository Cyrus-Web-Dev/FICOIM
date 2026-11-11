import { setRandomSource } from '@ficoim/shared';
import { getRandomBytes } from 'expo-crypto';
import { registerRootComponent } from 'expo';
import App from './App';

// Hermes tidak punya crypto.getRandomValues: ID (UUID v7) dan kripto backup memakai sumber acak aman milik OS.
setRandomSource((n) => getRandomBytes(n));
registerRootComponent(App);
