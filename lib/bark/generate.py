import sys
import os
import numpy as np
from scipy.io.wavfile import write as write_wav
from bark import generate_audio, SAMPLE_RATE
import json


os.environ["SUNO_ENABLE_MPS"] = "True"



def generate(text, output_dir):
    # Genera l'audio
    audio_array = generate_audio(text, history_prompt='v2/it_speaker_6')
    
    # Crea nome file univoco
    file_id = os.urandom(8).hex()
    raw_path = os.path.join(output_dir, f"{file_id}.raw")
    meta_path = os.path.join(output_dir, f"{file_id}.json")
    
    # Salva come raw PCM e metadati
    audio_array.tofile(raw_path)
    
    with open(meta_path, 'w') as f:
        json.dump({
            "sample_rate": SAMPLE_RATE,
            "channels": 1,
            "format": "float32"
        }, f)
    
    return file_id

if __name__ == "__main__":
    text = sys.argv[1]
    output_dir = sys.argv[2]
    file_id = generate(text, output_dir)
    print(file_id)