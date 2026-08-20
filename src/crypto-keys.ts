import { generateKeyPairSync } from 'node:crypto'

// Sunucu başlangıcında üretilen RSA anahtar çifti.
// Giriş bilgileri istemcide AES-GCM (simetrik) ile şifrelenir;
// AES anahtarı bu sunucu genel anahtarıyla (RSA-OAEP) sarılır ve
// sunucu özel anahtarıyla açılır. Böylece MITM bilgileri okuyamaz.
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

export const PUBLIC_KEY_PEM = publicKey
export const PRIVATE_KEY_PEM = privateKey