"""Records audio chunks to Google Cloud Storage."""
import logging

from google.cloud import storage

from config import GCS_BUCKET

logger = logging.getLogger(__name__)


class AudioRecorder:
    """Streams audio chunks to a GCS object via resumable upload."""

    def __init__(self, gcs_path: str):
        self.gcs_path = gcs_path
        self.client = storage.Client()
        self.bucket = self.client.bucket(GCS_BUCKET)
        self.blob = self.bucket.blob(gcs_path)
        self._chunks: list[bytes] = []
        self._finalized = False

    def write_chunk(self, chunk: bytes):
        """Buffer an audio chunk."""
        if self._finalized:
            return
        self._chunks.append(chunk)

    def get_audio_data(self) -> bytes:
        """Return raw buffered PCM audio data for post-processing."""
        return b"".join(self._chunks)

    def finalize(self) -> str:
        """Upload all buffered audio to GCS and return the path."""
        if self._finalized:
            return self.gcs_path

        self._finalized = True
        audio_data = b"".join(self._chunks)

        if not audio_data:
            logger.info("No audio data to upload")
            return self.gcs_path

        self.blob.upload_from_string(audio_data, content_type="audio/webm")
        logger.info("Audio uploaded to gs://%s/%s (%d bytes)", GCS_BUCKET, self.gcs_path, len(audio_data))
        return self.gcs_path
