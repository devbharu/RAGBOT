import json
from models.models import db, Report
from utils.telemetry import logger

class ReportRepository:
    @staticmethod
    def create_report(user_id: int, title: str, query: str, content: str, files: str) -> Report:
        """
        Creates a new report in the database.
        """
        try:
            report = Report(
                user_id=user_id,
                title=title,
                query=query,
                content=content,
                files=files
            )
            db.session.add(report)
            db.session.commit()
            return report
        except Exception as e:
            db.session.rollback()
            logger.error(f"[ReportRepository] Error creating report: {e}")
            raise

    @staticmethod
    def get_user_reports(user_id: int):
        """
        Fetch all reports for a user, ordered by newest first.
        """
        return db.session.query(Report).filter_by(user_id=user_id).order_by(Report.created_at.desc()).all()

    @staticmethod
    def delete_report(report_id: int, user_id: int) -> bool:
        """
        Deletes a report, ensuring ownership.
        """
        try:
            report = db.session.query(Report).filter_by(id=report_id, user_id=user_id).first()
            if not report:
                return False
            db.session.delete(report)
            db.session.commit()
            return True
        except Exception as e:
            db.session.rollback()
            logger.error(f"[ReportRepository] Error deleting report: {e}")
            return False
