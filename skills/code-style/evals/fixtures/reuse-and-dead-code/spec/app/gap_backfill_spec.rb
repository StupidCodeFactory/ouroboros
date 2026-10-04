RSpec.describe App::GapBackfill do
  include_context "with a listings db"

  it "returns listings with no gap row for the month" do
    stub_dashboard_gaps("BTCUSD", [202401])
    expect(described_class.new(db).missing(202401).map(&:symbol)).to contain_exactly("ETHUSD")
  end
end
