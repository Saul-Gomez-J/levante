# HuggingFace Inference Testing

Script de testing para probar la inferencia de modelos HuggingFace con diferentes proveedores.

## Configuración

### 1. Variables de Entorno

Asegúrate de tener `HF_TOKEN` configurado en `.env.local`:

```bash
HF_TOKEN=hf_your_token_here
```

### 2. Imagen de Prueba

Coloca una imagen de prueba en `test-assets/test-image.jpg`:

```bash
# Crear directorio
mkdir -p test-assets

# Copiar tu imagen de prueba
cp /ruta/a/tu/imagen.jpg test-assets/test-image.jpg
```

## Uso

### Ejecutar Todos los Tests

```bash
npx ts-node scripts/test-hf-inference.ts
```

### Ejecutar Solo Test de SDK

```bash
npx ts-node scripts/test-hf-inference.ts sdk
```

### Ejecutar Solo Test de API Directa

```bash
npx ts-node scripts/test-hf-inference.ts direct
```

## Tipos de Test

### 1. SDK Test (usando @huggingface/inference)

Prueba el SDK oficial con el parámetro `inputs`:

```typescript
const resultBlob = await client.imageToImage({
  provider: "wavespeed",
  model: "Qwen/Qwen-Image-Edit-2509",
  inputs: imageData,
  parameters: { prompt: "..." },
});
```

**Nota:** Este test puede fallar con modelos que requieren el formato `images` (como Qwen-Image-Edit-2509 con WaveSpeed).

### 2. Direct API Test

Hace una llamada directa a la API con el parámetro `images`:

```typescript
const response = await fetch('https://api.huggingface.co/models/...', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'x-provider': 'wavespeed',
  },
  body: JSON.stringify({
    images: [base64], // ✅ Formato correcto para WaveSpeed
    parameters: { prompt: "..." },
  }),
});
```

**Resultado:** Este test debería funcionar correctamente con WaveSpeed/Qwen.

## Resultados

Los resultados se guardan en:

- **SDK test:** `test-assets/output-image.png`
- **Direct API test:** `test-assets/output-image-direct.png`

## Troubleshooting

### Error: "property images is missing"

Esto indica que el modelo/provider requiere el formato `images` en lugar de `inputs`. Usa el test de API directa:

```bash
npx ts-node scripts/test-hf-inference.ts direct
```

### Error: "HF_TOKEN not set"

Configura tu token en `.env.local`:

```bash
echo "HF_TOKEN=hf_your_token_here" >> .env.local
```

### Error: "Test image not found"

Coloca una imagen de prueba en `test-assets/test-image.jpg`:

```bash
mkdir -p test-assets
cp ~/Downloads/mi-imagen.jpg test-assets/test-image.jpg
```

## Modelos Soportados

### WaveSpeed Provider

- ✅ `Qwen/Qwen-Image-Edit-2509` (requiere formato `images`)
- ✅ `Qwen/Qwen-Image-Edit`

### Otros Providers

Para probar otros providers, modifica el script:

```typescript
const config = {
  provider: "otro-provider",
  model: "modelo-id",
  inputs: imageData,
  parameters: { prompt: "..." },
};
```

## Logs Esperados

### Test Exitoso

```
🧪 Testing HuggingFace Image-to-Image Inference

✅ HF_TOKEN found: hf_lByjw...
✅ Test image found: /path/to/test-image.jpg
✅ InferenceClient initialized

📸 Reading test image...
✅ Image loaded: 319748 bytes

📋 Test Configuration:
   Provider: wavespeed
   Model: Qwen/Qwen-Image-Edit-2509
   Prompt: "Turn this into a beautiful watercolor painting"

🚀 Sending inference request...
✅ Inference completed in 5.43s

💾 Saving result...
✅ Result saved to: /path/to/output-image.png
   Size: 245632 bytes
   Type: image/png

✨ Test completed successfully!
```

### Test con Error

```
❌ Inference failed:
   Message: Failed to perform inference: invalid request body,
   Error at "/images": property "images" is missing
```

Esto indica que debes usar la API directa con formato `images`.
