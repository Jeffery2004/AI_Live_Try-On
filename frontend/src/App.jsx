import { useEffect, useRef, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function UploadCard({ id, title, description, value, onChange, onClear }) {
  const inputRef = useRef(null);
  const [preview, setPreview] = useState('');

  useEffect(() => {
    if (!value) {
      setPreview('');
      return undefined;
    }
    const objectUrl = URL.createObjectURL(value);
    setPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [value]);

  return (
    <section className={`upload-card ${preview ? 'has-image' : ''}`}>
      <div className="card-heading">
        <span className="step-number">{id === 'person' ? '01' : '02'}</span>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      {preview ? (
        <div className="preview-wrap">
          <img src={preview} alt={`${title} preview`} />
          <button type="button" className="remove-image" onClick={onClear} aria-label={`Remove ${title}`}>×</button>
        </div>
      ) : (
        <button type="button" className="drop-zone" onClick={() => inputRef.current?.click()}>
          <span className="upload-icon">↑</span>
          <strong>Choose an image</strong>
          <span>JPG, PNG or WEBP · max 10 MB</span>
        </button>
      )}
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
      {preview && <button type="button" className="change-image" onClick={() => inputRef.current?.click()}>Change image</button>}
    </section>
  );
}

export default function App() {
  const [person, setPerson] = useState(null);
  const [garment, setGarment] = useState(null);
  const [category, setCategory] = useState('upper');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [personResultUrl, setPersonResultUrl] = useState('');

  useEffect(() => () => {
    if (result?.imageUrl?.startsWith('blob:')) URL.revokeObjectURL(result.imageUrl);
  }, [result]);

  useEffect(() => {
    if (!person) { setPersonResultUrl(''); return undefined; }
    const imageUrl = URL.createObjectURL(person);
    setPersonResultUrl(imageUrl);
    return () => URL.revokeObjectURL(imageUrl);
  }, [person]);

  const selectImage = (setter) => (file) => {
    setError('');
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Please choose a JPG, PNG, or WEBP image.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('Each image must be 10 MB or smaller.');
      return;
    }
    setter(file);
  };

  const reset = () => {
    setPerson(null);
    setGarment(null);
    setCategory('upper');
    setError('');
    setResult(null);
  };

  const generate = async () => {
    setError('');
    setResult(null);
    if (!person || !garment) {
      setError('Add both a person photo and a garment image to continue.');
      return;
    }
    setIsLoading(true);
    try {
      const body = new FormData();
      body.append('person', person);
      body.append('garment', garment);
      body.append('category', category);
      const response = await fetch(`${API_URL}/api/try-on`, { method: 'POST', body });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? 'The try-on request could not be completed.');
      }
      if (!response.headers.get('content-type')?.startsWith('image/')) {
        throw new Error('The server did not return a generated image.');
      }
      const imageUrl = URL.createObjectURL(await response.blob());
      setResult({ imageUrl });
    } catch (requestError) {
      setError(requestError.message === 'Failed to fetch'
        ? 'Cannot reach the local server. Start the backend on port 4000 and try again.'
        : requestError.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main>
      <nav><a className="brand" href="#top">VirtualFit <i>AI</i></a><span>Virtual try-on studio</span></nav>
      <div className="page-shell" id="top">
        <header className="hero">
          <p className="eyebrow">PERSONAL FIT, VISUALIZED</p>
          <h1>Meet your next<br /><em>favorite look.</em></h1>
          <p className="intro">Upload a clear photo and a garment image. VirtualFit will prepare your try-on using an AI model when it is connected.</p>
        </header>

        <section className="studio" aria-label="Virtual try-on inputs">
          <UploadCard id="person" title="Your photo" description="Front-facing, well-lit, upper body visible." value={person} onChange={selectImage(setPerson)} onClear={() => setPerson(null)} />
          <div className="connector"><span>+</span></div>
          <UploadCard id="garment" title="Garment image" description="A flat product photo works best." value={garment} onChange={selectImage(setGarment)} onClear={() => setGarment(null)} />
        </section>

        <section className="settings">
          <div><p className="eyebrow">03 · GARMENT TYPE</p><h2>What are you trying on?</h2></div>
          <div className="category-list" role="radiogroup" aria-label="Garment category">
            {[['upper', 'Top', 'T-shirts, shirts, jackets'], ['jacket', 'Outerwear', 'Jackets and overshirts']].map(([value, label, detail]) => (
              <button key={value} type="button" className={category === value ? 'category active' : 'category'} onClick={() => setCategory(value)} role="radio" aria-checked={category === value}>
                <span className="radio-dot" /><span><strong>{label}</strong><small>{detail}</small></span>
              </button>
            ))}
          </div>
        </section>

        {error && <div className="message error" role="alert">{error}</div>}
        <button type="button" className="generate" onClick={generate} disabled={isLoading}>
          {isLoading ? <><span className="spinner" />Preparing your try-on…</> : <>Generate try-on <span>→</span></>}
        </button>
        <p className="privacy">Images are used only for this request and are not saved by this interface.</p>

        {result && <section className="result-section">
          <div className="result-header"><div><p className="eyebrow">YOUR VIRTUAL FIT</p><h2>Try-on result</h2></div><button type="button" className="text-button" onClick={reset}>Start over</button></div>
          <div className="result-grid"><img src={personResultUrl} alt="Original person" /><img src={result.imageUrl} alt="Generated virtual try-on" /></div>
          <a className="download" href={result.imageUrl} download="virtualfit-result.png">Download image ↓</a>
        </section>}
      </div>
      <footer>VIRTUALFIT AI · UPPER BODY TRY-ON EXPERIMENT</footer>
    </main>
  );
}
