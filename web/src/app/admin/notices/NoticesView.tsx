"use client";

import {
  ReviewQueueHeader,
  ReviewQueuePage,
  ReviewQueueStatePanel,
} from "../../../components/admin/review-queue/ReviewQueue";
import NoticeComposer, { type NoticeDraft, type NoticeDraftErrors } from "./NoticeComposer";
import NoticePreview from "./NoticePreview";
import SentNoticesList, { type SentNoticesState } from "./SentNoticesList";

export type NoticesViewProps = {
  canSend: boolean;
  draft: NoticeDraft;
  errors: NoticeDraftErrors;
  sending: boolean;
  /** People on the platform today; null while unknown or when the overview failed. */
  audienceSize: number | null;
  sent: SentNoticesState;
  onChange: (field: keyof NoticeDraft, value: string) => void;
  onRequestSend: () => void;
  onRetrySent: () => void;
};

/**
 * #2146: the operator page for platform broadcasts. Presentational: the page
 * owns the session, the requests and the confirmation, and passes state in.
 */
export default function NoticesView(props: NoticesViewProps) {
  return (
    <ReviewQueuePage className="admin-notices-page">
      <ReviewQueueHeader
        eyebrow="Operator"
        title="Platform notices"
        description="Tell people about a policy or terms change, or an incident. Moderation notices are sent automatically to the person affected."
      />
      {props.canSend ? (
        <>
          <div className="admin-notices-layout">
            <NoticeComposer
              draft={props.draft}
              errors={props.errors}
              sending={props.sending}
              audienceSize={props.audienceSize}
              onChange={props.onChange}
              onRequestSend={props.onRequestSend}
            />
            <NoticePreview draft={props.draft} />
          </div>
          <SentNoticesList state={props.sent} audienceSize={props.audienceSize} onRetry={props.onRetrySent} />
        </>
      ) : (
        <ReviewQueueStatePanel
          variant="forbidden"
          heading="Admins and operators only"
          body="Only operators and admins can send platform notices."
        />
      )}
    </ReviewQueuePage>
  );
}
