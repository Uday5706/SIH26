import os

class Settings:
    HOST: str = os.getenv("HOST", "127.0.0.1")
    PORT: int = int(os.getenv("PORT", 8000))
    VLM_BACKEND_TYPE: str = os.getenv("VLM_BACKEND_TYPE", "mock") # "ollama", "vllm", or "mock"
    OLLAMA_URL: str = os.getenv("OLLAMA_URL", "http://localhost:11434")
    OLLAMA_MODEL: str = os.getenv("OLLAMA_MODEL", "qwen2-vl:7b")

settings = Settings()
