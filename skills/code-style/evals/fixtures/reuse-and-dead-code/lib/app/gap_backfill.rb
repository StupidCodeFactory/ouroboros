module App
  class GapBackfill
    LISTING_COLUMNS = %i[id symbol venue listed_at delisted_at].freeze

    def initialize(db)
      @db = db
    end

    def missing(month)
      @db[:listings].select(*LISTING_COLUMNS).exclude(id: @db[:gaps].where(month: month).select(:listing_id)).map { |row| listing_of(row) }
    end

    private

    def listing_of(row)
      Listing.new(id: row[:id], symbol: row[:symbol], venue: row[:venue], listed_at: row[:listed_at], delisted_at: Text.blank_to_nil(row[:delisted_at]))
    end
  end
end
