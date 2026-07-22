import { useTranslation } from "react-i18next";
import type { JobState } from "../../../hooks/useJobStream";
import JobCard from "./JobCard";
import { PackageOpen } from "lucide-react";
import "./JobList.scss";

type Props = {
  jobs: Map<string, JobState>;
  onTagWithBeets: (artist: string, album: string) => void;
};

export default function JobList({ jobs, onTagWithBeets }: Props) {
  const { t } = useTranslation();
  if (jobs.size === 0) {
    return (
      <div className="job-list__empty">
        <PackageOpen size={40} className="job-list__empty__icon" />
        <p>{t('import.no_jobs')}</p>
      </div>
    );
  }

  const sorted = [...jobs.values()].sort((a, b) => {
    const order = ["awaiting_prompt", "unzipping", "parsing", "copying", "queued", "done", "error"];
    return order.indexOf(a.status) - order.indexOf(b.status);
  });

  return (
    <div className="job-list">
      {sorted.map((job) => (
        <JobCard
          key={job.id}
          job={job}
          onTagWithBeets={
            job.status === "done" && job.artist && job.album
              ? () => onTagWithBeets(job.artist!, job.album!)
              : undefined
          }
        />
      ))}
    </div>
  );
}
