DB_URL=$(gcloud run services describe resonate-dev-backend --region europe-west1 --format="value(template.containers[0].env)" | tr ';' '\n' | grep ^DATABASE_URL= | cut -d'=' -f2-)
VPC_CONN=$(gcloud run services describe resonate-dev-backend --region europe-west1 --format="value(spec.template.metadata.annotations['run.googleapis.com/vpc-access-connector'])")

echo "DATABASE_URL: '${DB_URL}'" > final-env.yaml

gcloud run jobs create final-ff \
  --region=europe-west1 \
  --image=europe-west1-docker.pkg.dev/gen-lang-client-0683924123/resonate-dev/db-update:latest \
  --vpc-connector=${VPC_CONN} \
  --env-vars-file=final-env.yaml

gcloud run jobs execute final-ff --region europe-west1 --wait
gcloud run jobs executions list --job final-ff --region europe-west1 --format="value(name)" | head -n 1 | xargs -I {} gcloud run jobs executions logs read {} --region europe-west1
