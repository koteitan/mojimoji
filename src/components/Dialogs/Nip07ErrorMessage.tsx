import { useTranslation } from 'react-i18next';

const NOS2X_URL = 'https://chromewebstore.google.com/detail/nos2x/kpgefcfmnafjgpblomihpgmejjdanjjp';
const ALBY_URL = 'https://getalby.com/';

interface Nip07ErrorMessageProps {
  messageKey: string;
}

export function Nip07ErrorMessage({ messageKey }: Nip07ErrorMessageProps) {
  const { t, i18n } = useTranslation();
  const isJapanese = i18n.language.startsWith('ja');

  return (
    <div className="dialog-error">
      {isJapanese ? (
        <>
          NIP-07拡張機能が見つかりません。
          <a href={NOS2X_URL} target="_blank" rel="noopener noreferrer">nos2x</a>
          や
          <a href={ALBY_URL} target="_blank" rel="noopener noreferrer">Alby</a>
          などのNostr署名拡張機能をインストールしてください。
        </>
      ) : (
        <>
          NIP-07 extension not available. Please install a Nostr signer extension like{' '}
          <a href={NOS2X_URL} target="_blank" rel="noopener noreferrer">nos2x</a>
          {' '}or{' '}
          <a href={ALBY_URL} target="_blank" rel="noopener noreferrer">Alby</a>.
        </>
      )}
    </div>
  );
}
