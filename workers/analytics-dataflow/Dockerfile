FROM gcr.io/dataflow-templates-base/python312-template-launcher-base@sha256:e25576104a8e886722e8d12abaa9a8870740088fde0c6543741c6c2502b079d1

WORKDIR /template

COPY requirements.lock .
RUN python -m pip install --no-cache-dir --require-hashes -r requirements.lock

COPY analytics_transform.py main.py setup.py ./
RUN python -m pip install --no-cache-dir --no-build-isolation --no-deps .

ENV FLEX_TEMPLATE_PYTHON_PY_FILE="/template/main.py"
ENV FLEX_TEMPLATE_PYTHON_REQUIREMENTS_FILE="/template/requirements.lock"
ENV FLEX_TEMPLATE_PYTHON_SETUP_FILE="/template/setup.py"
ENV PYTHONPATH="/template"
